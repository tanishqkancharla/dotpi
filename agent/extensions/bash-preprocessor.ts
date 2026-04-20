/**
 * Bash Preprocessor Extension
 *
 * Normalizes bash commands before execution:
 * - Removes unnecessary "cd <repo-path> && " prefixes
 * - Replaces absolute repo paths with relative paths
 *
 * Rewrites both the executed command (tool_call) and the displayed command
 * (message_update) so the TUI shows the stripped version.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

function rewriteCommand(command: string, repoPath: string): string {
	const escapedRepoPath = repoPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	// Remove "cd <repo-path> && " from the start
	const cdPrefixRegex = new RegExp(`^cd\\s+${escapedRepoPath}\\s+&&\\s+`);
	command = command.replace(cdPrefixRegex, "");

	// Replace all occurrences of absolute repo path with relative path
	const repoPathRegex = new RegExp(escapedRepoPath + "/", "g");
	command = command.replace(repoPathRegex, "");

	// Replace standalone repo path (not followed by /)
	const standaloneRepoPathRegex = new RegExp(`\\b${escapedRepoPath}\\b(?!/)`, "g");
	command = command.replace(standaloneRepoPathRegex, ".");

	return command;
}

export default function (pi: ExtensionAPI) {
	pi.on("message_update", async (event, ctx) => {
		if (event.message.role !== "assistant") return;

		for (const block of event.message.content) {
			if (
				block.type === "toolCall" &&
				block.name === "bash" &&
				typeof block.arguments?.command === "string"
			) {
				block.arguments.command = rewriteCommand(block.arguments.command, ctx.cwd);
			}
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		event.input.command = rewriteCommand(event.input.command, ctx.cwd);
	});
}
