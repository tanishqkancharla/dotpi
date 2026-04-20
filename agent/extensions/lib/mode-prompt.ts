import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  truncateToWidth,
  type TUI,
} from "@mariozechner/pi-tui";

import { loadAllModes } from "./mode-utils.js";

export type ModePromptResult = {
  text: string;
  modeName?: string;
};

type ModePromptOptions = {
  label: string;
  placeholder: string;
};

class ModePromptDialog {
  private editor: Editor;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private modeIndex = 0;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.editor.focused = value;
  }

  constructor(
    private tui: TUI,
    private theme: any,
    private modeNames: string[],
    private options: ModePromptOptions,
    private done: (result: ModePromptResult | null) => void,
  ) {
    const editorTheme: EditorTheme = {
      borderColor: (s) => this.theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t) => this.theme.fg("accent", t),
        selectedText: (t) => this.theme.fg("accent", t),
        description: (t) => this.theme.fg("muted", t),
        scrollInfo: (t) => this.theme.fg("dim", t),
        noMatch: (t) => this.theme.fg("warning", t),
      },
    };

    this.editor = new Editor(tui, editorTheme);
    this.editor.setText("");
    this.editor.onSubmit = (value) => {
      const text = value.trim();
      if (!text) return;
      this.done({ text, modeName: this.getSelectedModeName() });
    };
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };
  }

  private getSelectedModeName(): string | undefined {
    if (this.modeIndex === 0) return undefined;
    return this.modeNames[this.modeIndex - 1];
  }

  private refresh(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(null);
      return;
    }

    if (matchesKey(data, "ctrl+space")) {
      if (this.modeNames.length > 0) {
        this.modeIndex = (this.modeIndex + 1) % (this.modeNames.length + 1);
        this.refresh();
      }
      return;
    }

    this.editor.handleInput(data);
    this.refresh();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const modeLabel = this.getSelectedModeName() ?? "current";
    const lines: string[] = [];
    lines.push(
      truncateToWidth(
        this.theme.fg("accent", `${this.options.label} `) +
          this.theme.fg("dim", `mode: ${modeLabel}`),
        width,
      ),
    );

    const editorLines = this.editor.render(width);
    if (editorLines.length === 0) {
      lines.push(
        truncateToWidth(this.theme.fg("dim", this.options.placeholder), width),
      );
    } else {
      for (const line of editorLines) {
        lines.push(truncateToWidth(line, width));
      }
    }

    lines.push("");
    lines.push(
      truncateToWidth(
        this.theme.fg(
          "dim",
          "Enter submit • Shift+Enter newline • Ctrl+Space cycle mode • Esc cancel",
        ),
        width,
      ),
    );

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.editor.invalidate();
  }
}

export async function promptForTextWithMode(
  ctx: ExtensionContext,
  options: ModePromptOptions,
): Promise<ModePromptResult | null> {
  if (!ctx.hasUI) return null;

  const modeNames = Object.keys(loadAllModes());
  return ctx.ui.custom<ModePromptResult | null>(
    (tui, theme, _kb, done) =>
      new ModePromptDialog(tui, theme, modeNames, options, done),
    {
      overlay: true,
      overlayOptions: {
        width: "70%",
        minWidth: 50,
        maxWidth: 100,
        anchor: "center",
      },
    },
  );
}
