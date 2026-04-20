import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const REPORT_PATH = "/tmp/session-diff-report.md";
const VIEWER_SCRIPT =
  dirname(new URL(import.meta.url).pathname) + "/explain-diff-viewer.mjs";

export default function (pi: ExtensionAPI) {
  let viewerPaneId: string | null = null;

  async function inTmux(): Promise<boolean> {
    const r = await pi.exec(
      "tmux",
      ["display-message", "-p", "#{session_id}"],
      { timeout: 2000 },
    );
    return r.code === 0;
  }

  async function openViewerPane(ctx: any) {
    if (viewerPaneId) return;

    if (!(await inTmux())) {
      ctx.ui.notify(
        "Not in tmux — explain-diff sidebar requires tmux",
        "warning",
      );
      return;
    }

    // Ensure the report file exists
    if (!existsSync(REPORT_PATH)) {
      writeFileSync(REPORT_PATH, "", "utf-8");
    }

    const split = await pi.exec("tmux", [
      "split-window",
      "-h",
      "-d",
      "-l",
      "50%",
      "-P",
      "-F",
      "#{pane_id}",
      "--",
      "node",
      VIEWER_SCRIPT,
      REPORT_PATH,
      "--cwd",
      ctx.cwd,
    ]);

    if (split.code === 0) {
      viewerPaneId = split.stdout.trim();
      ctx.ui.setStatus("explain-diff", "explain-diff ↗");
    } else {
      ctx.ui.notify(`Failed to open viewer pane: ${split.stderr}`, "error");
    }
  }

  async function closeViewerPane() {
    if (!viewerPaneId) return;
    await pi.exec("tmux", ["kill-pane", "-t", viewerPaneId]);
    viewerPaneId = null;
  }

  pi.registerCommand("explain-diff", {
    description: "Toggle explain-diff viewer in a tmux side pane",
    handler: async (_args, ctx) => {
      if (viewerPaneId) {
        const check = await pi.exec(
          "tmux",
          ["has-session", "-t", viewerPaneId],
          { timeout: 1000 },
        );
        if (check.code === 0) {
          await closeViewerPane();
          ctx.ui.setStatus("explain-diff", undefined);
          ctx.ui.notify("Explain-diff pane closed", "info");
          return;
        }
        viewerPaneId = null;
      }

      await openViewerPane(ctx);
    },
  });

  // After agent finishes, prompt it to write the diff explanation
  pi.on("agent_end", async (_event, ctx) => {
    // Only trigger if the viewer pane is open
    if (!viewerPaneId) return;

    // Check the pane is still alive
    const check = await pi.exec("tmux", ["has-session", "-t", viewerPaneId], {
      timeout: 1000,
    });
    if (check.code !== 0) {
      viewerPaneId = null;
      ctx.ui.setStatus("explain-diff", undefined);
      return;
    }

    // Send a follow-up message to have the agent update the diff report
    pi.sendUserMessage(
      [
        {
          type: "text",
          text: `Update the diff explanation file at ${REPORT_PATH}. Inspect the current session changes with \`git diff\` and \`git status --short\`, then write a markdown file that explains what changed and why. Use this format:

- Start with a heading and brief summary
- For each logical change, write a section explaining it
- Use \`!\\\`git diff -- path/to/file\\\`\` on its own line to include live diffs (these are expanded at render time by the viewer)
- Order sections to best explain the narrative of changes
- Keep it concise — show only the most informative parts

Example:
\`\`\`
# Refactored auth module

Extracted token validation into standalone middleware for reuse across routes.

## Token validation middleware

Pulled \`validateToken\` out of the route handler into its own middleware.

!\`git diff --unified=3 -- src/middleware/auth.ts\`

## Updated route wiring

Both routers now use the new middleware.

!\`git diff -- src/routes/api.ts\`
\`\`\`

Write the file now using the write tool.`,
        },
      ],
      { deliverAs: "followUp" },
    );
  });

  pi.on("session_shutdown", async () => {
    await closeViewerPane();
  });
}
