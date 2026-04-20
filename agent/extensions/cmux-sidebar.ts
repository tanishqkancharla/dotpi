import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import path from "node:path";

type ContentBlock = {
	type?: string;
	text?: string;
	name?: string;
};

const STATUS_KEY = "pi";
const LOCATION_KEY = "location";
const MAX_LOG_CHARS = 180;

function isCmuxContext(): boolean {
	return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SOCKET_PATH);
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxChars = MAX_LOG_CHARS): string {
	if (text.length <= maxChars) return text;
	return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function extractTextParts(content: unknown): string[] {
	if (typeof content === "string") {
		return [content];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	const textParts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") {
			textParts.push(part);
			continue;
		}

		if (!part || typeof part !== "object") {
			continue;
		}

		const block = part as ContentBlock;
		if (block.type === "text" && typeof block.text === "string") {
			textParts.push(block.text);
		}
	}

	return textParts;
}

function extractToolNames(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return [];
	}

	const names: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}

		const block = part as ContentBlock;
		if (block.type === "toolCall" && typeof block.name === "string") {
			names.push(block.name);
		}
	}

	return [...new Set(names)];
}

function countBlockType(content: unknown, type: string): number {
	if (!Array.isArray(content)) {
		return 0;
	}

	let count = 0;
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}

		const block = part as ContentBlock;
		if (block.type === type) {
			count++;
		}
	}

	return count;
}

function summarizeText(content: unknown): string | undefined {
	const joined = normalizeWhitespace(extractTextParts(content).join(" "));
	if (!joined) {
		return undefined;
	}
	return truncate(joined);
}

function summarizeUserContent(content: unknown): string | undefined {
	const textSummary = summarizeText(content);
	if (textSummary) {
		return textSummary;
	}

	const imageCount = countBlockType(content, "image");
	if (imageCount > 0) {
		return imageCount === 1 ? "[image attached]" : `[${imageCount} images attached]`;
	}

	return undefined;
}

function summarizeAssistantContent(content: unknown): { summary?: string; textSummary?: string } {
	const textSummary = summarizeText(content);
	if (textSummary) {
		return { summary: textSummary, textSummary };
	}

	const toolNames = extractToolNames(content);
	if (toolNames.length > 0) {
		return { summary: truncate(`[tool calls: ${toolNames.join(", ")}]`) };
	}

	return {};
}

function summarizeToolResult(result: unknown, toolName: string): string {
	if (result && typeof result === "object") {
		const maybeContent = (result as { content?: unknown }).content;
		const textSummary = summarizeText(maybeContent);
		if (textSummary) {
			return textSummary;
		}
	}

	return `${toolName} failed`;
}

export default function (pi: ExtensionAPI) {
	let currentState: "ready" | "working" | "done" | "needs-review" = "ready";
	let hadError = false;
	let lastUserSummary = "";
	let lastAssistantTextSummary = "";

	async function runCmux(args: string[]): Promise<void> {
		if (!isCmuxContext()) return;

		try {
			await pi.exec("cmux", args, { timeout: 3000 });
		} catch {
			// Ignore cmux/socket errors so the extension remains harmless outside cmux.
		}
	}

	async function setStatus(value: string, icon: string, color: string): Promise<void> {
		await runCmux(["set-status", STATUS_KEY, value, "--icon", icon, "--color", color]);
	}

	async function setMetadata(key: string, value: string): Promise<void> {
		await runCmux(["set-status", key, value]);
	}

	async function clearSidebarState(): Promise<void> {
		await runCmux(["clear-status", STATUS_KEY]);
		await runCmux(["clear-status", LOCATION_KEY]);
		await runCmux(["clear-log"]);
	}

	async function log(level: "info" | "progress" | "success" | "warning" | "error", source: string, message: string): Promise<void> {
		await runCmux(["log", "--level", level, "--source", source, message]);
	}

	async function notify(title: string, subtitle: string, body: string): Promise<void> {
		await runCmux(["notify", "--title", title, "--subtitle", subtitle, "--body", body]);
	}

	async function currentLocationLabel(cwd: string): Promise<string> {
		const dirName = path.basename(cwd) || cwd;
		try {
			const result = await pi.exec("git", ["-C", cwd, "branch", "--show-current"], { timeout: 1500 });
			const branch = normalizeWhitespace(result.stdout || "");
			if (branch) {
				return `${dirName} (${branch})`;
			}
		} catch {
			// Non-git directory or git unavailable.
		}
		return dirName;
	}

	async function refreshLocationMetadata(cwd: string): Promise<void> {
		const label = await currentLocationLabel(cwd);
		await setMetadata(LOCATION_KEY, label);
	}

	async function resetWorkspaceState(cwd: string): Promise<void> {
		hadError = false;
		lastUserSummary = "";
		lastAssistantTextSummary = "";
		currentState = "ready";
		await clearSidebarState();
		await refreshLocationMetadata(cwd);
	}

	pi.on("session_start", async (_event, ctx) => {
		await resetWorkspaceState(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await resetWorkspaceState(ctx.cwd);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		hadError = false;
		currentState = "working";
		lastUserSummary = truncate(normalizeWhitespace(event.prompt || ""));
		await refreshLocationMetadata(ctx.cwd);
		await runCmux(["clear-status", STATUS_KEY]);
	});

	pi.on("message_end", async (event, _ctx) => {
		const message = event.message as { role?: string; content?: unknown };
		if (!message || typeof message !== "object") return;

		if (message.role === "user") {
			const summary = summarizeUserContent(message.content);
			if (!summary) return;

			lastUserSummary = summary;
			await log("info", "user", `user: ${summary}`);
			return;
		}

		if (message.role === "assistant") {
			const { summary, textSummary } = summarizeAssistantContent(message.content);
			if (!summary) return;

			if (textSummary) {
				lastAssistantTextSummary = textSummary;
			}

			await log("info", "pi", `pi: ${summary}`);
		}
	});

	pi.on("tool_execution_end", async (event, _ctx) => {
		if (!event.isError) return;

		hadError = true;
		currentState = "needs-review";
		const errorSummary = truncate(normalizeWhitespace(summarizeToolResult(event.result, event.toolName)));

		await setStatus("Needs review", "exclamationmark.triangle", "#ff3b30");
		await log("error", event.toolName, `error: ${errorSummary}`);
	});

	pi.on("agent_end", async (_event, _ctx) => {
		if (hadError) {
			currentState = "needs-review";
			await setStatus("Needs review", "exclamationmark.triangle", "#ff3b30");
			await notify(
				"Pi",
				"Needs review",
				lastAssistantTextSummary || lastUserSummary || "Pi finished with errors",
			);
			return;
		}

		currentState = "done";
		await runCmux(["clear-status", STATUS_KEY]);
		await notify("Pi", "Done", lastAssistantTextSummary || lastUserSummary || "Ready for input");
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		await runCmux(["clear-status", STATUS_KEY]);
	});
}
