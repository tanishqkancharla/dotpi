import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execFile } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";
import { sep } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(execFile);

function sanitizeNotificationText(value: string): string {
	return value.replace(/[\x07\x1b\r\n;]/g, " ").trim();
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function getMessageText(message: unknown): string {
	if (typeof message !== "object" || message === null || !("content" in message)) {
		return "";
	}

	const content = message.content;
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.filter((part): part is { type: string; text: string } => {
			if (typeof part !== "object" || part === null) return false;
			if (!("type" in part) || !("text" in part)) return false;
			return typeof part.type === "string" && part.type === "text" && typeof part.text === "string";
		})
		.map((part) => part.text)
		.join("\n");
}

function isAssistantMessage(message: unknown): message is { role: "assistant"; content: unknown } {
	if (typeof message !== "object" || message === null || !("role" in message)) {
		return false;
	}
	return message.role === "assistant";
}

function isUserMessage(message: unknown): message is { role: "user"; content: unknown } {
	if (typeof message !== "object" || message === null || !("role" in message)) {
		return false;
	}
	return message.role === "user";
}

function writeToTty(text: string): boolean {
	try {
		const fd = openSync("/dev/tty", "w");
		writeSync(fd, text);
		closeSync(fd);
		return true;
	} catch {
		return false;
	}
}

function formatLocation(cwd: string): string {
	const parts = cwd.split(sep).filter((part) => part.length > 0);
	const tail = parts.slice(-2);
	if (tail.length === 0) return cwd;
	return tail.join("/");
}

function getSessionTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
	const sessionName = pi.getSessionName();
	if (sessionName && sessionName.trim().length > 0) {
		return sessionName.trim();
	}

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || !("message" in entry)) continue;
		if (!isUserMessage(entry.message)) continue;

		const text = collapseWhitespace(getMessageText(entry.message));
		if (text.length > 0) {
			return truncateText(text, 80);
		}
	}

	return formatLocation(ctx.cwd);
}

function getAssistantSnippet(messages: unknown[]): string {
	const lastAssistant = [...messages].reverse().find(isAssistantMessage);
	if (!lastAssistant) return "Ready for your input";

	const text = collapseWhitespace(getMessageText(lastAssistant));
	if (text.length === 0) return "Ready for your input";

	return truncateText(text, 160);
}

function sendGhosttyNotification(title: string, body: string): boolean {
	const safeTitle = sanitizeNotificationText(title);
	const safeBody = sanitizeNotificationText(body);
	const bellSent = writeToTty("\x07");
	const notificationSent = writeToTty(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
	return bellSent || notificationSent;
}

export default function (pi: ExtensionAPI) {
	let enabled = false;

	pi.registerCommand("notify", {
		description: "Toggle desktop notifications when the agent finishes",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`Notifications ${enabled ? "on" : "off"}`, "info");
			ctx.ui.setStatus("notify", enabled ? "🔔" : undefined);
		},
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!enabled) return;

		const title = getSessionTitle(pi, ctx);
		const body = getAssistantSnippet(event.messages);

		if (process.env.TERM_PROGRAM === "ghostty") {
			const sent = sendGhosttyNotification(title, body);
			if (sent) return;
		}

		await execAsync("osascript", [
			"-e",
			`display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} sound name "Glass"`,
		]).catch(() => {});
	});
}
