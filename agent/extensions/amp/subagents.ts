/**
 * Subagent system — discovers agent definitions from markdown files
 * and registers each as a separate tool.
 *
 * Agent definitions are loaded from:
 *   ~/.pi/agent/agents/*.md  (global)
 *   .pi/agents/*.md          (project-local, loaded at session_start)
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as module from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import {
  type SingleResult,
  type SubagentDetails,
  emptyUsage,
  formatToolCall,
  renderResultExpanded,
  runSubagent,
} from "./subagent-core.js";
import { createCustomTools } from "./tools.js";
import { createFffSubagentTools } from "./fff-subagent-tools.js";

const esmRequire = module.createRequire(
  new URL(".", `file://${os.homedir()}/.pi/agent/extensions/`).href,
);
const yamlMod: { parse: (str: string) => any } = esmRequire("yaml");
const parseYaml = yamlMod.parse;

// ---------------------------------------------------------------------------
// Agent definition types and parsing
// ---------------------------------------------------------------------------

interface ParamDef {
  type: "string" | "string[]";
  description?: string;
  required?: boolean;
}

interface AgentDef {
  name: string;
  description: string;
  snippet: string;
  model: string;
  thinkingLevel: string;
  tools: string[];
  params?: Record<string, ParamDef>;
  systemPrompt: string;
}

/**
 * Parse YAML frontmatter from an agent markdown file.
 */
function parseAgentFile(filePath: string): AgentDef | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;

  const meta = parseYaml(match[1]!);
  if (!meta || typeof meta !== "object" || meta.mode !== "subagent")
    return null;

  const body = match[2]!.trim();
  const name = path.basename(filePath, ".md");
  const description = (meta.description as string) || `${name} subagent`;
  const snippet =
    (meta.snippet as string) || description.split("\n")[0]!.slice(0, 120);

  // Parse params if present
  let params: Record<string, ParamDef> | undefined;
  if (
    meta.params &&
    typeof meta.params === "object" &&
    !Array.isArray(meta.params)
  ) {
    params = {};
    for (const [paramName, paramObj] of Object.entries(
      meta.params as Record<string, any>,
    )) {
      if (!paramObj || typeof paramObj !== "object") continue;
      params[paramName] = {
        type: paramObj.type === "string[]" ? "string[]" : "string",
        description: paramObj.description,
        required: !!paramObj.required,
      };
    }
  }

  return {
    name,
    description,
    snippet,
    model: (meta.model as string) || "",
    thinkingLevel: (meta.thinkingLevel as string) || "off",
    tools: (meta.tools as string[]) || ["read", "bash", "edit", "write"],
    params,
    systemPrompt: body,
  };
}

/**
 * Scan a directory for agent definition .md files.
 */
function scanAgentDir(dirPath: string): AgentDef[] {
  if (!fs.existsSync(dirPath)) return [];

  const agents: AgentDef[] = [];
  for (const file of fs.readdirSync(dirPath)) {
    if (!file.endsWith(".md")) continue;
    const def = parseAgentFile(path.join(dirPath, file));
    if (def) agents.push(def);
  }
  return agents;
}

// ---------------------------------------------------------------------------
// Tool builder — resolves tool names to AgentTool instances
// ---------------------------------------------------------------------------

/** Lazily cached custom tools */
let _customTools: AgentTool<any>[] | undefined;
function getCustomTools(): AgentTool<any>[] {
  if (!_customTools) _customTools = createCustomTools();
  return _customTools;
}

/** Lazily cached fff tools, keyed by cwd */
const _fffToolsCache = new Map<string, Map<string, AgentTool<any>>>();
function getFffToolsByName(cwd: string): Map<string, AgentTool<any>> {
  let cached = _fffToolsCache.get(cwd);
  if (!cached) {
    try {
      const fffTools = createFffSubagentTools(cwd);
      cached = new Map(fffTools.map((t) => [t.name, t]));
    } catch {
      // pi-fff not installed or failed to load — use empty map
      cached = new Map();
    }
    _fffToolsCache.set(cwd, cached);
  }
  return cached;
}

/**
 * Build the tool set for a subagent from its declared tool names.
 * Supports all built-in SDK tools, fff-enhanced tools, and custom tools.
 *
 * When pi-fff is available, `read`, `grep`, `find_files`, and `fff_multi_grep`
 * are replaced with fff-powered versions that support fuzzy path resolution
 * and indexed content search.
 */
function buildSubagentTools(
  cwd: string,
  toolNames: string[],
): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [];
  const added = new Set<string>();

  const customTools = getCustomTools();
  const customToolsByName = new Map(customTools.map((t) => [t.name, t]));
  const fffToolsByName = getFffToolsByName(cwd);

  for (const name of toolNames) {
    if (added.has(name)) continue;
    added.add(name);

    // Check for fff-enhanced version first (read, grep, find_files, fff_multi_grep)
    const fffTool = fffToolsByName.get(name);
    if (fffTool) {
      tools.push(fffTool);
      continue;
    }

    // Built-in SDK tools
    switch (name) {
      case "read":
        tools.push(createReadTool(cwd));
        continue;
      case "bash":
        tools.push(createBashTool(cwd));
        continue;
      case "edit":
        tools.push(createEditTool(cwd));
        continue;
      case "write":
        tools.push(createWriteTool(cwd));
        continue;
      case "find":
        tools.push(createFindTool(cwd));
        continue;
      case "grep":
        tools.push(createGrepTool(cwd));
        continue;
      case "ls":
        tools.push(createLsTool(cwd));
        continue;
    }

    // Custom tools (apply_patch, web tools, etc.)
    const customTool = customToolsByName.get(name);
    if (customTool) {
      tools.push(customTool);
      continue;
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), ".pi", "agent", "agents");

// ---------------------------------------------------------------------------
// Parameter schema building
// ---------------------------------------------------------------------------

function buildParamSchema(agent: AgentDef) {
  if (!agent.params) {
    return Type.Object({
      task: Type.String({
        description: `Task prompt for the ${agent.name} subagent. The subagent has no conversation history — include all relevant context (file paths, decisions, requirements) and exact task description in this prompt.`,
      }),
    });
  }

  const props: Record<string, any> = {};
  for (const [paramName, def] of Object.entries(agent.params)) {
    const opts: Record<string, any> = {};
    if (def.description) opts.description = def.description;

    let schema: any;
    if (def.type === "string[]") {
      schema = Type.Array(Type.String(), opts);
    } else {
      schema = Type.String(opts);
    }

    props[paramName] = def.required ? schema : Type.Optional(schema);
  }
  return Type.Object(props);
}

function extractTask(agent: AgentDef, params: any): string | null {
  if (!agent.params) {
    const task = params.task;
    return typeof task === "string" && task.trim() ? task : null;
  }

  const parts: string[] = [];
  for (const [paramName, def] of Object.entries(agent.params)) {
    const val = params[paramName];
    if (val === undefined || val === null) continue;
    if (def.type === "string[]" && Array.isArray(val) && val.length > 0) {
      parts.push(
        `## ${paramName}\n\n${val.map((v: string) => `- ${v}`).join("\n")}`,
      );
    } else if (typeof val === "string" && val.trim()) {
      parts.push(`## ${paramName}\n\n${val}`);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// Agent tool registration
// ---------------------------------------------------------------------------

function registerAgentTool(pi: ExtensionAPI, agent: AgentDef): void {
  const params = buildParamSchema(agent);

  pi.registerTool({
    name: agent.name,
    label: agent.name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    description: agent.description,
    promptSnippet: agent.snippet,
    promptGuidelines: [
      `The ${agent.name} subagent is non-interactive and has no conversation history. Include ALL relevant context (file paths, decisions, requirements) and exact task description in this prompt.`,
    ],
    parameters: params,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const task = extractTask(agent, params);

      if (!task) {
        return {
          content: [{ type: "text", text: "Provide a task." }],
          details: { results: [] },
        };
      }

      // Resolve model from agent definition
      let targetModel = ctx.model;
      const targetThinkingLevel = agent.thinkingLevel || pi.getThinkingLevel();

      if (agent.model) {
        const slashIdx = agent.model.indexOf("/");
        if (slashIdx > 0) {
          const provider = agent.model.slice(0, slashIdx);
          const modelId = agent.model.slice(slashIdx + 1);
          const m = ctx.modelRegistry.find(provider, modelId);
          if (m) targetModel = m;
        }
      }

      if (!targetModel) {
        return {
          content: [{ type: "text", text: "No model available." }],
          details: { results: [] },
        };
      }

      const tools = buildSubagentTools(ctx.cwd, agent.tools);
      const systemPrompt = agent.systemPrompt;

      const apiKeyResolver = async (_provider: string) => {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(targetModel!);
        if (!auth.ok) return undefined;
        return auth.apiKey;
      };

      const makeDetails = (results: SingleResult[]): SubagentDetails => ({
        results,
      });

      const placeholder: SingleResult = {
        task,
        exitCode: -1,
        displayItems: [],
        finalOutput: "",
        usage: emptyUsage(),
      };

      onUpdate?.({
        content: [{ type: "text", text: "(running...)" }],
        details: makeDetails([placeholder]),
      });

      const result = await runSubagent(
        systemPrompt,
        task,
        tools,
        targetModel!,
        targetThinkingLevel,
        apiKeyResolver,
        signal,
        (r) => {
          onUpdate?.({
            content: [{ type: "text", text: r.finalOutput || "(running...)" }],
            details: makeDetails([r]),
          });
        },
      );

      return {
        content: [
          {
            type: "text",
            text: `[${result.exitCode === 0 ? "✓" : "✗"}] ${result.finalOutput || "(no output)"}`,
          },
        ],
        details: makeDetails([result]),
        isError: result.exitCode !== 0,
      };
    },

    renderCall(args, theme) {
      const task =
        (agent.params ? null : args.task) ||
        Object.values(args).find((v) => typeof v === "string") ||
        "";
      const taskStr = String(task);
      // Show up to 2 lines of task text
      const lines = taskStr.split("\n").filter((l: string) => l.trim());
      const preview =
        lines.length <= 2
          ? lines.join("\n")
          : lines.slice(0, 2).join("\n") + "…";
      return new Text(
        `${theme.fg("toolTitle", theme.bold(agent.name))} ${theme.fg("dim", preview)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as SubagentDetails | undefined;
      const r = details?.results[0];

      if (!r) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" ? text.text : "(no output)",
          0,
          0,
        );
      }

      // Expanded: full task prompt, tool calls, markdown output, usage
      if (expanded) {
        const container = new Container();
        const mdTheme = getMarkdownTheme();
        renderResultExpanded(r, container, theme, mdTheme);
        return container;
      }

      // Collapsed: preview of output (like bash collapsed view)
      const isRunning = r.exitCode === -1;
      if (isRunning) {
        // Show last few tool calls as progress
        const items = r.displayItems.slice(-4);
        const lines: string[] = [];
        for (const item of items) {
          if (item.type === "toolCall") {
            lines.push(
              theme.fg("muted", "→ ") +
                formatToolCall(item.name, item.args, theme.fg.bind(theme)),
            );
          }
        }
        const body = lines.length > 0 ? lines.join("\n") : theme.fg("dim", "(running…)");
        return new Text("\n" + body, 0, 0);
      }

      // Finished collapsed: show final output preview
      const output = r.finalOutput || "(no output)";
      const outputLines = output.split("\n").filter((l: string) => l.trim());
      const preview =
        outputLines.length <= 6
          ? outputLines.join("\n")
          : outputLines.slice(0, 6).join("\n") +
            `\n… (${outputLines.length - 6} more lines)`;
      return new Text("\n" + theme.fg("dim", preview), 0, 0);
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function registerSubagents(pi: ExtensionAPI): void {
  const registered = new Set<string>();

  // Load global agents at startup
  for (const agent of scanAgentDir(GLOBAL_AGENTS_DIR)) {
    registerAgentTool(pi, agent);
    registered.add(agent.name);
  }

  // Load project-local agents at session start
  pi.on("session_start", (_event, ctx) => {
    const projectDir = path.join(ctx.cwd, ".pi", "agents");
    for (const agent of scanAgentDir(projectDir)) {
      if (!registered.has(agent.name)) {
        registerAgentTool(pi, agent);
        registered.add(agent.name);
      }
    }
  });
}
