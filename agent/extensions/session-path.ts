import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("path", {
    description: "Log the current session file path",
    handler: async (_args, ctx) => {
      const path = ctx.sessionManager.getSessionFile();
      if (path) {
        ctx.ui.notify(path, "info");
      } else {
        ctx.ui.notify("No session file (ephemeral session)", "warn");
      }
    },
  });
}
