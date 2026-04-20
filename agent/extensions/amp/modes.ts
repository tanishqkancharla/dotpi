import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { loadAllModes, type ModeSpec } from "../lib/mode-utils.js";

// =============================================================================
// Types
// =============================================================================

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// =============================================================================
// Current-mode persistence
// =============================================================================

function getGlobalAgentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR;
  if (env) {
    if (env === "~") return os.homedir();
    if (env.startsWith("~/")) return path.join(os.homedir(), env.slice(2));
    return env;
  }
  return path.join(os.homedir(), ".pi", "agent");
}

function getCurrentModeFilePath(): string {
  return path.join(getGlobalAgentDir(), "current-mode");
}

function readCurrentModeName(): string {
  try {
    return fs.readFileSync(getCurrentModeFilePath(), "utf8").trim();
  } catch {
    return "";
  }
}

function writeCurrentModeName(name: string): void {
  const filePath = getCurrentModeFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, name + "\n", "utf8");
  } catch {
    // Best-effort persistence
  }
}

// =============================================================================
// Runtime state
// =============================================================================

let modes: Record<string, ModeSpec> = {};
let currentMode = "";

// Serializes cycle shortcut repeats so rapid key presses can't race
let modeCycleQueue: Promise<void> = Promise.resolve();

function modeNames(): string[] {
  return Object.keys(modes);
}

function hasModes(): boolean {
  return modeNames().length > 0;
}

function emitModeUpdate(pi: ExtensionAPI): void {
  const spec = currentMode ? modes[currentMode] : undefined;
  pi.events.emit("mode:update", {
    mode: currentMode,
    color: spec?.color,
  });
}

function refreshModes(): void {
  modes = loadAllModes();

  if (!hasModes()) {
    currentMode = "";
    return;
  }

  // Validate current mode still exists
  if (!currentMode || !modes[currentMode]) {
    const persisted = readCurrentModeName();
    if (persisted && modes[persisted]) {
      currentMode = persisted;
    } else {
      const names = modeNames();
      currentMode = names.includes("smart") ? "smart" : names[0]!;
    }
  }
}

// =============================================================================
// Apply mode
// =============================================================================

export async function applyMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  mode: string,
): Promise<void> {
  refreshModes();

  if (!hasModes()) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        "No modes defined. Add .md files to ~/.pi/agent/agents/ with mode: primary frontmatter.",
        "info",
      );
    }
    return;
  }

  const spec = modes[mode];
  if (!spec) {
    if (ctx.hasUI) {
      ctx.ui.notify(`Unknown mode: ${mode}`, "warning");
    }
    return;
  }

  currentMode = mode;

  if (spec.provider && spec.modelId) {
    const model = ctx.modelRegistry.find(spec.provider, spec.modelId);
    if (model) {
      const ok = await pi.setModel(model);
      if (!ok && ctx.hasUI) {
        ctx.ui.notify(
          `No API key available for ${spec.provider}/${spec.modelId}`,
          "warning",
        );
      }
    } else if (ctx.hasUI) {
      ctx.ui.notify(
        `Mode "${mode}" references unknown model ${spec.provider}/${spec.modelId}`,
        "warning",
      );
    }
  }

  if (spec.thinkingLevel) {
    pi.setThinkingLevel(spec.thinkingLevel as ThinkingLevel);
  }

  if (spec.tools && spec.tools.length > 0) {
    pi.setActiveTools(spec.tools);
  }

  writeCurrentModeName(mode);
  emitModeUpdate(pi);
}

// =============================================================================
// Cycling
// =============================================================================

async function cycleModeNow(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  direction: 1 | -1 = 1,
): Promise<void> {
  refreshModes();
  const names = modeNames();
  if (names.length === 0) return;

  const idx = Math.max(0, names.indexOf(currentMode));
  const next =
    names[(idx + direction + names.length) % names.length] ?? names[0]!;
  await applyMode(pi, ctx, next);
}

async function cycleMode(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  direction: 1 | -1 = 1,
): Promise<void> {
  const run = modeCycleQueue.then(
    () => cycleModeNow(pi, ctx, direction),
    () => cycleModeNow(pi, ctx, direction),
  );
  modeCycleQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

// =============================================================================
// Extension export
// =============================================================================

export function registerModes(pi: ExtensionAPI) {
  pi.registerCommand("mode", {
    description: "Select agent mode",
    handler: async (args, ctx) => {
      const modeName = args.trim();

      if (modeName) {
        await applyMode(pi, ctx, modeName);
        return;
      }

      // Show picker
      if (!ctx.hasUI) return;
      refreshModes();

      if (!hasModes()) {
        ctx.ui.notify(
          "No modes defined. Add .md files to ~/.pi/agent/agents/ with mode: primary frontmatter.",
          "info",
        );
        return;
      }

      const choice = await ctx.ui.select(
        `Mode (current: ${currentMode})`,
        modeNames(),
      );
      if (!choice) return;

      await applyMode(pi, ctx, choice);
    },
  });

  pi.registerShortcut("ctrl+shift+s", {
    description: "Select prompt mode",
    handler: async (ctx) => {
      refreshModes();
      if (!hasModes()) return;

      if (!ctx.hasUI) return;
      const choice = await ctx.ui.select(
        `Mode (current: ${currentMode})`,
        modeNames(),
      );
      if (!choice) return;

      await applyMode(pi, ctx, choice);
    },
  });

  pi.registerShortcut("ctrl+space", {
    description: "Cycle prompt mode",
    handler: async (ctx) => {
      await cycleMode(pi, ctx, 1);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    refreshModes();
    if (hasModes() && currentMode) {
      await applyMode(pi, ctx, currentMode);
    }
  });

  pi.on("session_switch", async (_event, _ctx) => {
    refreshModes();
    emitModeUpdate(pi);
  });
}
