import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function extractUserText(content: unknown): { text: string; droppedNonText: boolean } {
	if (typeof content === "string") {
		return { text: content, droppedNonText: false };
	}

	if (!Array.isArray(content)) {
		return { text: "", droppedNonText: false };
	}

	let droppedNonText = false;
	const text = content
		.flatMap((part) => {
			if (!part || typeof part !== "object") {
				droppedNonText = true;
				return [];
			}

			const candidate = part as { type?: unknown; text?: unknown };
			if (candidate.type === "text" && typeof candidate.text === "string") {
				return [candidate.text];
			}

			droppedNonText = true;
			return [];
		})
		.join("");

	return { text, droppedNonText };
}

export default function undoExtension(pi: ExtensionAPI) {
	pi.registerCommand("undo", {
		description: "Revert the last user message and restore it to the editor",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				return;
			}

			if (!ctx.isIdle()) {
				ctx.abort();
				await ctx.waitForIdle();
			}

			const branch = ctx.sessionManager.getBranch();
			const lastUserEntry = [...branch].reverse().find((entry) => {
				return (
					entry.type === "message" &&
					"role" in entry.message &&
					entry.message.role === "user"
				);
			});

			if (!lastUserEntry || lastUserEntry.type !== "message" || lastUserEntry.message.role !== "user") {
				ctx.ui.notify("Nothing to undo in this session.", "info");
				return;
			}

			const { text, droppedNonText } = extractUserText(lastUserEntry.message.content);

			if (!text) {
				ctx.ui.notify("The last user message does not contain restorable text.", "info");
				return;
			}

			const leafId = ctx.sessionManager.getLeafId();

			if (leafId === lastUserEntry.id) {
				if (lastUserEntry.parentId == null) {
					ctx.ui.notify(
						"Undo is not available yet for the current root prompt. Wait for the reply to start, then run /undo again.",
						"warning",
					);
					return;
				}

				const result = await ctx.navigateTree(lastUserEntry.parentId, { summarize: false });
				if (result.cancelled) {
					return;
				}
			} else {
				const result = await ctx.navigateTree(lastUserEntry.id, { summarize: false });
				if (result.cancelled) {
					return;
				}
			}

			ctx.ui.setEditorText(text);

			ctx.ui.notify(
				droppedNonText
					? "Restored the last user message text. Non-text attachments were not restored."
					: "Restored the last user message to the editor.",
				"success",
			);
		},
	});
}
