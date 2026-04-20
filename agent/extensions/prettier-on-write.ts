/**
 * Prettier On Write Extension
 *
 * Auto-formats files after `write` and `edit` tool calls using prettier,
 * if prettier is available in the project or globally.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";

export default function (pi: ExtensionAPI) {
	let prettierAvailable: boolean | null = null;

	async function checkPrettier(cwd: string): Promise<boolean> {
		if (prettierAvailable !== null) return prettierAvailable;
		try {
			const result = await pi.exec("npx", ["prettier", "--version"], {
				timeout: 10000,
			});
			prettierAvailable = result.code === 0;
		} catch {
			prettierAvailable = false;
		}
		return prettierAvailable;
	}

	async function formatFile(filePath: string, cwd: string): Promise<void> {
		const absolutePath = resolve(cwd, filePath);
		try {
			await pi.exec("npx", ["prettier", "--write", absolutePath], {
				timeout: 15000,
			});
		} catch {
			// Silently ignore formatting failures (unsupported file types, syntax errors, etc.)
		}
	}

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		if (event.isError) return;

		const filePath = (event.input as { path?: string }).path;
		if (!filePath) return;

		if (!(await checkPrettier(ctx.cwd))) return;

		await formatFile(filePath, ctx.cwd);
	});
}
