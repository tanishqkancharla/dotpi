/**
 * Shared mode resolution utilities.
 *
 * Modes are defined by .md files in ~/.pi/agent/agents/ with YAML frontmatter
 * containing `mode: primary`.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export type ModeSpec = {
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
	tools?: string[];
	color?: string;
};

function getAgentsDir(): string {
	const env = process.env.PI_CODING_AGENT_DIR;
	const agentDir = env
		? (env === "~" ? os.homedir() : env.startsWith("~/") ? path.join(os.homedir(), env.slice(2)) : env)
		: path.join(os.homedir(), ".pi", "agent");
	return path.join(agentDir, "agents");
}

/**
 * Parse a primary mode spec from an .md file's YAML frontmatter.
 * Returns undefined if the file isn't a primary mode definition.
 */
function parseModeFile(filePath: string): ModeSpec | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}

	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return undefined;

	const yaml = match[1]!;
	const modeField = yaml.match(/^mode:\s*(.+)$/m);
	if (!modeField || modeField[1]!.trim() !== "primary") return undefined;

	const providerField = yaml.match(/^provider:\s*(.+)$/m);
	const modelIdField = yaml.match(/^modelId:\s*(.+)$/m);
	const thinkingField = yaml.match(/^thinkingLevel:\s*(.+)$/m);
	const colorField = yaml.match(/^color:\s*(.+)$/m);

	let tools: string[] | undefined;
	const toolsMatch = yaml.match(/^tools:\s*\[([^\]]*)\]/ms);
	if (toolsMatch) {
		tools = toolsMatch[1]!
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
	}

	return {
		provider: providerField ? providerField[1]!.trim() : undefined,
		modelId: modelIdField ? modelIdField[1]!.trim() : undefined,
		thinkingLevel: thinkingField ? thinkingField[1]!.trim() : undefined,
		color: colorField ? colorField[1]!.trim() : undefined,
		tools,
	};
}

/**
 * Load all primary mode specs from .md files in the agents directory.
 */
export function loadAllModes(): Record<string, ModeSpec> {
	const agentsDir = getAgentsDir();
	const modes: Record<string, ModeSpec> = {};

	let files: string[];
	try {
		files = fs.readdirSync(agentsDir);
	} catch {
		return modes;
	}

	for (const file of files) {
		if (!file.endsWith(".md")) continue;
		const spec = parseModeFile(path.join(agentsDir, file));
		if (spec) {
			modes[path.basename(file, ".md")] = spec;
		}
	}

	return modes;
}

/**
 * Load a single mode spec by name from its .md file.
 */
export function loadModeSpec(modeName: string): ModeSpec | undefined {
	return parseModeFile(path.join(getAgentsDir(), `${modeName}.md`));
}
