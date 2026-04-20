import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("update", {
		description: "Update pi to the latest version and reload",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Updating pi...", "info");
			const result = await pi.exec("npm", ["install", "-g", "@mariozechner/pi-coding-agent"], { timeout: 60000 });
			if (result.code !== 0) {
				ctx.ui.notify(`Update failed (exit ${result.code}): ${result.stderr}`, "error");
				return;
			}
			ctx.ui.notify("Update complete, reloading...", "success");
			await ctx.reload();
		},
	});
}
