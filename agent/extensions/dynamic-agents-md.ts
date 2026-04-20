/**
 * Dynamic AGENTS.md Extension
 *
 * Automatically discovers and injects AGENTS.md files from subdirectories
 * when the agent reads files in those directories. AGENTS.md files at the
 * project root and above are already loaded by Pi at startup; this extension
 * handles the rest.
 *
 * Uses Pi's native format:
 *   ## /absolute/path/to/AGENTS.md
 *   ...contents...
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const SYSTEM_PROMPT_SNIPPET = `
AGENTS.md instructions are delivered dynamically in the conversation context, you don't have to read or search for them. The contents of AGENTS.md files at the root and directories up to the CWD are included automatically. When working in subdirectories, additional AGENTS.md files are discovered and injected as you access files in those directories.`;

function formatAgentsMd(absPath: string, content: string): string {
  return `## ${absPath}\n\n${content}`;
}

export default function dynamicAgentsMdExtension(pi: ExtensionAPI) {
  // Track discovered AGENTS.md: absolute path -> content
  const discovered = new Map<string, string>();
  let cwd = "";

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    discovered.clear();
  });

  /**
   * Scan from `dir` up to (but not including) cwd for AGENTS.md files.
   * Returns paths of newly discovered files.
   */
  function scanForAgentsMd(dir: string): string[] {
    const newPaths: string[] = [];
    let current = dir;

    // Walk up from dir, stopping before cwd (Pi already loads cwd and above)
    while (current.length > cwd.length && current.startsWith(cwd)) {
      const candidate = path.join(current, "AGENTS.md");
      if (!discovered.has(candidate)) {
        try {
          if (fs.existsSync(candidate)) {
            const content = fs.readFileSync(candidate, "utf-8").trim();
            if (content) {
              discovered.set(candidate, content);
              newPaths.push(candidate);
            }
          }
        } catch {
          // Ignore read errors
        }
      }
      current = path.dirname(current);
    }

    return newPaths;
  }

  // Modify system prompt: add snippet + all discovered AGENTS.md
  pi.on("before_agent_start", async (event) => {
    let systemPrompt = event.systemPrompt + "\n" + SYSTEM_PROMPT_SNIPPET;

    for (const [absPath, content] of discovered) {
      systemPrompt += "\n\n" + formatAgentsMd(absPath, content);
    }

    return { systemPrompt };
  });

  // On read tool results, scan for AGENTS.md in the file's directory tree
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read") return;

    const input = event.input as { path?: string };
    if (!input?.path) return;

    const filePath = path.isAbsolute(input.path)
      ? input.path
      : path.resolve(cwd, input.path);
    const dir = path.dirname(filePath);

    const newPaths = scanForAgentsMd(dir);

    // If we discovered new AGENTS.md files mid-run, inject them as a
    // steering message so the LLM sees them on its next turn.
    if (newPaths.length > 0) {
      const blocks = newPaths.map((p) => {
        return formatAgentsMd(p, discovered.get(p)!);
      });

      pi.sendMessage(
        {
          customType: "dynamic-agents-md",
          content: blocks.join("\n\n"),
          display: false,
        },
        { deliverAs: "steer" },
      );
    }
  });
}
