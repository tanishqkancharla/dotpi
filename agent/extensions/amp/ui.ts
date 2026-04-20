import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import { visibleWidth, type EditorTheme, type TUI } from "@mariozechner/pi-tui";

interface UIState {
  contextPercent: number | null;
  contextTokens: number | null;
  totalCost: number;
  modelName: string;
  thinkingLevel: string;
  gitBranch: string | null;
  cwd: string;
  diffStat: string | null;
  modeName: string;
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(0)}k`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function computeSessionCost(ctx: ExtensionContext): number {
  let cost = 0;
  for (const e of ctx.sessionManager.getBranch()) {
    if (e.type === "message" && e.message.role === "assistant") {
      const m = e.message as AssistantMessage;
      cost += m.usage.cost.total;
    }
  }
  return cost;
}

function shortenPath(fullPath: string, home: string): string {
  if (fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length);
  }
  return fullPath;
}

const MARGIN = 0;

class AmpEditor extends CustomEditor {
  private uiState: UIState;
  private appTheme: Theme;

  constructor(
    tui: TUI,
    editorTheme: EditorTheme,
    keybindings: KeybindingsManager,
    appTheme: Theme,
    initialState: UIState,
  ) {
    super(tui, editorTheme, keybindings);
    this.uiState = initialState;
    this.appTheme = appTheme;
  }

  requestRender(): void {
    this.tui.requestRender();
  }

  updateState(state: UIState): void {
    this.uiState = state;
  }

  updateAppTheme(theme: Theme): void {
    this.appTheme = theme;
  }

  render(width: number): string[] {
    const boxWidth = Math.max(1, width - MARGIN * 2);
    const contentWidth = Math.max(1, boxWidth - 2);
    const lines = super.render(contentWidth);
    if (lines.length < 2) return lines;

    const pad = " ".repeat(MARGIN);

    const result: string[] = [];
    result.push(pad + this.renderTopBorder(boxWidth));

    const contentLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const stripped = lines[i]!.replace(/\x1b\[[0-9;]*m/g, "");
      const isBorder = /^─/.test(stripped);
      if (isBorder && i === lines.length - 1) {
        break;
      }
      contentLines.push(pad + " " + lines[i]! + " ");
    }

    const minContentLines = 2;
    while (contentLines.length < minContentLines) {
      contentLines.push(pad + " " + " ".repeat(contentWidth) + " ");
    }

    result.push(...contentLines);

    const lastBorderIdx = this.findLastBorderLine(lines);
    result.push(
      pad +
        this.renderBottomBorder(
          boxWidth,
          lastBorderIdx >= 0 ? lines[lastBorderIdx]! : undefined,
        ),
    );

    return result;
  }

  private findLastBorderLine(lines: string[]): number {
    for (let i = lines.length - 1; i >= 0; i--) {
      const stripped = lines[i]!.replace(/\x1b\[[0-9;]*m/g, "");
      if (/^─/.test(stripped)) {
        return i;
      }
    }
    return lines.length - 1;
  }

  private renderTopBorder(width: number): string {
    const t = this.appTheme;
    const bc = (s: string) => this.borderColor(s);

    let leftContent = "";
    if (
      this.uiState.contextPercent !== null &&
      this.uiState.contextTokens !== null
    ) {
      leftContent =
        t.fg(
          "muted",
          `${this.uiState.contextPercent}% of ${formatTokens(this.uiState.contextTokens)}`,
        ) +
        t.fg("dim", " · ") +
        t.fg("muted", formatCost(this.uiState.totalCost));
    } else {
      leftContent = t.fg("muted", formatCost(this.uiState.totalCost));
    }

    const rightContent = this.uiState.modeName
      ? t.fg("accent", this.uiState.modeName)
      : "";

    const leftVisible = visibleWidth(leftContent);
    const rightVisible = visibleWidth(rightContent);
    const fillerWidth = width - leftVisible - rightVisible - 2;

    if (fillerWidth < 2) {
      return bc("─".repeat(Math.max(0, width)));
    }

    return (
      bc("─") +
      leftContent +
      bc("─".repeat(fillerWidth)) +
      rightContent +
      bc("─")
    );
  }

  private renderBottomBorder(width: number, originalLine?: string): string {
    const t = this.appTheme;
    const bc = (s: string) => this.borderColor(s);

    const strippedOriginal = originalLine?.replace(/\x1b\[[0-9;]*m/g, "") || "";
    const hasScrollIndicator = /^─── [↓]/.test(strippedOriginal);

    if (hasScrollIndicator) {
      const match = strippedOriginal.match(/^─── ↓ (\d+) more /);
      if (match) {
        const indicator = bc(`─── ↓ ${match[1]} more `);
        const indicatorVisible = visibleWidth(indicator);
        const remaining = width - indicatorVisible;
        return indicator + bc("─".repeat(Math.max(0, remaining)));
      }
    }

    let shortCwd = shortenPath(this.uiState.cwd, process.env.HOME || "");
    const branchSuffix = this.uiState.gitBranch
      ? ` (${this.uiState.gitBranch})`
      : "";
    // Border uses: filler (min 2) + content + "─" (1) = content + 3
    const maxTextWidth = width - 3;

    if (maxTextWidth < 1) {
      return bc("─".repeat(Math.max(0, width)));
    }

    // Truncate cwd from the left if path + branch won't fit
    const branchLen = branchSuffix.length;
    const maxCwdLen = maxTextWidth - branchLen;
    if (maxCwdLen < 4) {
      // Not even room for a truncated path — just show branch if it fits
      if (branchLen > 0 && branchLen <= maxTextWidth) {
        shortCwd = "";
      } else {
        return bc("─".repeat(Math.max(0, width)));
      }
    } else if (shortCwd.length > maxCwdLen) {
      shortCwd = "…" + shortCwd.slice(shortCwd.length - maxCwdLen + 1);
    }

    let rightContent: string;
    if (this.uiState.gitBranch) {
      rightContent = t.fg("muted", shortCwd) + t.fg("dim", branchSuffix);
    } else {
      rightContent = t.fg("muted", shortCwd);
    }

    const rightVisible = visibleWidth(rightContent);
    const fillerWidth = width - rightVisible - 1;

    if (fillerWidth < 2) {
      return bc("─".repeat(Math.max(0, width)));
    }

    return bc("─".repeat(fillerWidth)) + rightContent + bc("─");
  }
}

function parseDiffStat(stat: string, theme: Theme): string {
  const match = stat.match(
    /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
  );
  if (!match) return theme.fg("dim", stat);

  const files = match[1];
  const insertions = match[2] || "0";
  const deletions = match[3] || "0";

  return (
    theme.fg("muted", `${files} files changed `) +
    theme.fg("success", `+${insertions}`) +
    " " +
    theme.fg("error", `-${deletions}`)
  );
}

export function registerUI(pi: ExtensionAPI) {
  const uiState: UIState = {
    contextPercent: null,
    contextTokens: null,
    totalCost: 0,
    modelName: "",
    thinkingLevel: "off",
    gitBranch: null,
    cwd: "",
    diffStat: null,
    modeName: "",
  };

  let editorRef: AmpEditor | null = null;
  let currentCtx: ExtensionContext | null = null;

  // Listen for mode changes from the modes extension
  pi.events.on("mode:update", (event: any) => {
    uiState.modeName = event.mode || "";
    editorRef?.updateState(uiState);
    editorRef?.requestRender();
  });

  function refreshState(ctx: ExtensionContext): void {
    const usage = ctx.getContextUsage();
    uiState.contextPercent =
      usage?.percent != null ? Math.round(usage.percent) : null;
    uiState.contextTokens = usage?.contextWindow ?? null;
    uiState.totalCost = computeSessionCost(ctx);
    uiState.modelName = ctx.model?.name || ctx.model?.id || "";
    uiState.thinkingLevel = pi.getThinkingLevel();
    uiState.cwd = ctx.cwd;
    editorRef?.updateState(uiState);
  }

  async function refreshGitInfo(ctx: ExtensionContext): Promise<void> {
    try {
      const branchResult = await pi.exec(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        {
          timeout: 3000,
          cwd: ctx.cwd,
        },
      );
      uiState.gitBranch =
        branchResult.code === 0 ? branchResult.stdout.trim() : null;

      const diffResult = await pi.exec("git", ["diff", "--stat", "HEAD"], {
        timeout: 3000,
        cwd: ctx.cwd,
      });
      if (diffResult.code === 0 && diffResult.stdout.trim()) {
        const lines = diffResult.stdout.trim().split("\n");
        const summaryLine = lines[lines.length - 1] || "";
        uiState.diffStat = summaryLine.trim();
      } else {
        uiState.diffStat = null;
      }
    } catch {
      uiState.gitBranch = null;
      uiState.diffStat = null;
    }
    editorRef?.updateState(uiState);
    updateDiffWidget(ctx);
  }

  function updateDiffWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (uiState.diffStat) {
      ctx.ui.setWidget("amp-diff", (_tui: TUI, theme: Theme) => ({
        render(width: number): string[] {
          const text = parseDiffStat(uiState.diffStat!, theme);
          const textWidth = visibleWidth(text);
          const padding = " ".repeat(Math.max(0, width - textWidth - MARGIN));
          return ["", padding + text];
        },
        invalidate() {},
      }));
    } else {
      ctx.ui.setWidget("amp-diff", (_tui: TUI, _theme: Theme) => ({
        render(): string[] {
          return [""];
        },
        invalidate() {},
      }));
    }
  }

  function setupEditor(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    currentCtx = ctx;
    refreshState(ctx);

    ctx.ui.setEditorComponent(
      (tui: TUI, editorTheme: EditorTheme, keybindings: KeybindingsManager) => {
        const editor = new AmpEditor(
          tui,
          editorTheme,
          keybindings,
          ctx.ui.theme,
          uiState,
        );
        editorRef = editor;
        return editor;
      },
    );

    ctx.ui.setFooter((_tui: TUI, _theme: Theme, footerData) => {
      const unsub = footerData.onBranchChange(() => {
        if (currentCtx) refreshGitInfo(currentCtx);
      });

      return {
        dispose: unsub,
        invalidate() {},
        render(): string[] {
          return Array(MARGIN).fill("");
        },
      };
    });

    refreshGitInfo(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    setupEditor(ctx);
  });

  pi.on("session_switch", (_event, ctx) => {
    setupEditor(ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    refreshState(ctx);
    refreshGitInfo(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    refreshState(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    refreshState(ctx);
  });

  pi.on("message_end", (_event, ctx) => {
    refreshState(ctx);
  });
}
