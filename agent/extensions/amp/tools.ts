import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as module from "node:module";

import { applyPatch } from "./patch.js";

// google-auth-library lives in pi's node_modules — resolve from there
const piRequire = module.createRequire(
  "/Users/tanishqkancharla/.nvm/versions/node/v23.7.0/lib/node_modules/@mariozechner/pi-coding-agent/package.json",
);
const { GoogleAuth } = piRequire("google-auth-library");

const SERVICE_ACCOUNT_KEY_PATH =
  "/Users/tanishqkancharla/.pi/agent/gcloud-sa-key.json";

function previewLines(text: string, maxLines = 6): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n… (${lines.length - maxLines} more lines)`
  );
}

const THREE_DAYS_IN_SECONDS = 3 * 24 * 60 * 60;

function isGitHubUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === "github.com" || hostname.endsWith(".githubusercontent.com")
    );
  } catch {
    return false;
  }
}

const GITHUB_HINT = "\n\nHint: For GitHub content, use the `gh` CLI instead.";

function withGitHubHint(message: string, url: string): string {
  return isGitHubUrl(url) ? message + GITHUB_HINT : message;
}

let _parallelApiKey: string | undefined;

async function getParallelApiKey(): Promise<string> {
  if (_parallelApiKey) return _parallelApiKey;

  if (process.env.PARALLEL_API_KEY) {
    _parallelApiKey = process.env.PARALLEL_API_KEY;
    return _parallelApiKey;
  }

  try {
    const auth = new GoogleAuth({
      keyFile: SERVICE_ACCOUNT_KEY_PATH,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const resp = await fetch(
      "https://secretmanager.googleapis.com/v1/projects/saffron-health/secrets/parallel-api-key/versions/latest:access",
      { headers: { Authorization: `Bearer ${token.token}` } },
    );

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Secret Manager API error (${resp.status}): ${errorText}`);
    }

    const data = await resp.json();
    _parallelApiKey = Buffer.from(data.payload.data, "base64").toString("utf8");
    return _parallelApiKey;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to get Parallel API key. Set PARALLEL_API_KEY env var or ensure ${SERVICE_ACCOUNT_KEY_PATH} is valid: ${message}`,
    );
  }
}

// ── Shared fetch logic ─────────────────────────────────────────────────────

async function fetchReadWebPage(
  params: { url: string; objective?: string; forceRefetch?: boolean },
  signal?: AbortSignal,
): Promise<{ text: string; url: string; hasObjective: boolean }> {
  const apiKey = await getParallelApiKey();
  const hasObjective = !!params.objective;

  const requestBody: Record<string, unknown> = {
    urls: [params.url],
    excerpts: hasObjective
      ? { max_chars_per_result: 10000, max_chars_total: 30000 }
      : false,
    full_content: hasObjective ? false : { max_chars_per_result: 50000 },
  };

  if (params.objective) {
    requestBody.objective = params.objective;
  }

  if (params.forceRefetch) {
    requestBody.fetch_policy = { max_age_seconds: 600 };
  } else {
    requestBody.fetch_policy = { max_age_seconds: THREE_DAYS_IN_SECONDS };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch("https://api.parallel.ai/v1beta/extract", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "parallel-beta": "search-extract-2025-10-10",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err: any) {
    throw new Error(
      withGitHubHint(`Parallel API fetch failed: ${err.message}`, params.url),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      withGitHubHint(
        `Parallel API error (${response.status}): ${errorText}`,
        params.url,
      ),
    );
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return {
      text: withGitHubHint("No content found for the given URL.", params.url),
      url: params.url,
      hasObjective,
    };
  }

  const result = data.results[0];
  let text: string;

  if (hasObjective && result.excerpts && result.excerpts.length > 0) {
    text = result.excerpts.join("\n\n");
  } else if (result.full_content) {
    text = result.full_content;
  } else if (result.excerpts && result.excerpts.length > 0) {
    text = result.excerpts.join("\n\n");
  } else {
    text = "No content extracted from the page.";
  }

  return {
    text: withGitHubHint(text, params.url),
    url: params.url,
    hasObjective,
  };
}

async function fetchSearchWeb(
  params: {
    objective: string;
    search_queries?: string[];
    max_results?: number;
  },
  signal?: AbortSignal,
): Promise<{ text: string; results: any[] }> {
  const apiKey = await getParallelApiKey();

  const requestBody: Record<string, unknown> = {
    mode: "agentic",
    objective: params.objective,
    max_results: params.max_results ?? 5,
    excerpts: { max_chars_per_result: 10000, max_chars_total: 50000 },
  };

  if (params.search_queries) {
    requestBody.search_queries = params.search_queries;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch("https://api.parallel.ai/v1beta/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "parallel-beta": "search-extract-2025-10-10",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err: any) {
    throw new Error(`Parallel search failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Parallel API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  const results = data.results.map((result: any) => ({
    title: result.title,
    url: result.url,
    excerpts: result.excerpts || [],
  }));

  let text = JSON.stringify(results, null, 2);

  const hasGitHubResults = results.some((r: any) => isGitHubUrl(r.url));
  if (hasGitHubResults) {
    text += GITHUB_HINT;
  }

  return { text, results };
}

// ── registerTools ──────────────────────────────────────────────────────────

export function registerTools(pi: ExtensionAPI) {
  // ── apply_patch ───────────────────────────────────────────────────────
  pi.registerTool({
    name: "apply_patch",
    label: "Apply Patch",
    description:
      "Apply a patch to create, update, move, or delete files. Uses a concise patch format with context lines for matching.",
    promptGuidelines: [
      `Use the apply_patch tool to edit files. The patch format uses \`*** Begin Patch\` / \`*** End Patch\` markers with file operations inside.`,
      `File operations: \`*** Add File: <path>\` (new file, lines prefixed with +), \`*** Delete File: <path>\`, \`*** Update File: <path>\` (with optional \`*** Move to: <path>\`).`,
      `Update hunks start with \`@@\` (optionally followed by a context header like a class/function name). Lines start with \` \` (context), \`-\` (remove), or \`+\` (add).`,
      `Include ~3 lines of context before and after each change. Use \`@@ className\` or \`@@ methodName\` headers if context lines alone aren't unique enough.`,
      `File paths must be relative, NEVER absolute.`,
      `Example:\n\`\`\`\n*** Begin Patch\n*** Update File: src/app.ts\n@@ function main()\n import { foo } from "./foo";\n-console.log("old");\n+console.log("new");\n import { bar } from "./bar";\n*** End Patch\n\`\`\``,
    ],
    parameters: Type.Object({
      patch: Type.String({
        description:
          "The patch text in Codex patch format (*** Begin Patch ... *** End Patch)",
      }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = applyPatch(params.patch, ctx.cwd);
      return {
        content: [{ type: "text", text: result }],
        details: { patch: params.patch },
      };
    },
  });

  // ── read_web_page ──────────────────────────────────────────────────────
  pi.registerTool({
    name: "read_web_page",
    label: "Read Web Page",
    description: `Read contents of a web page.`,
    promptGuidelines: [
      "Do NOT use read_web_page for localhost or any other local/non-Internet-accessible URLs; use curl via bash instead.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to read" }),
      objective: Type.Optional(
        Type.String({
          description: "Research goal (returns relevant excerpts)",
        }),
      ),
      forceRefetch: Type.Optional(
        Type.Boolean({
          description: "Force live fetch",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const { text, url, hasObjective } = await fetchReadWebPage(
        params,
        signal,
      );
      return {
        content: [{ type: "text", text }],
        details: { url, hasObjective },
      };
    },

    renderCall(args, theme) {
      let header = theme.fg("toolTitle", theme.bold("read_web_page "));
      header += theme.fg("dim", args.url ?? "");
      if (args.objective) {
        header += " " + theme.fg("dim", args.objective);
      }
      return new Text(header, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const content =
        result.content?.[0]?.type === "text" ? result.content[0].text : "";

      if (!expanded) {
        const preview = previewLines(content);
        return new Text(theme.fg("dim", preview), 0, 0);
      }
      return new Text(content, 0, 0);
    },
  });

  pi.registerTool({
    name: "search_web",
    label: "Search Web",
    description: "Search the web for information.",
    parameters: Type.Object({
      objective: Type.String({
        description: "Research goal description",
      }),
      search_queries: Type.Optional(
        Type.Array(Type.String(), {
          description: "Keyword queries",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Max results (default: 5)",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const { text, results } = await fetchSearchWeb(params, signal);
      return {
        content: [{ type: "text", text }],
        details: {
          objective: params.objective,
          resultCount: results.length,
          results,
        },
      };
    },

    renderCall(args, theme) {
      let header = theme.fg("toolTitle", theme.bold("search_web "));
      if (args.objective) {
        header += theme.fg("dim", args.objective);
      }
      return new Text(header, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as { results?: any[] } | undefined;
      const items = details?.results ?? [];
      const content =
        result.content?.[0]?.type === "text" ? result.content[0].text : "";

      if (!expanded) {
        const listing = items
          .map(
            (r: any) =>
              `  • ${theme.bold(r.url)} ${theme.fg("dim", r.title ?? "")}`,
          )
          .join("\n");
        return new Text(listing, 0, 0);
      }
      return new Text(content, 0, 0);
    },
  });
}

// ── createSubagentTools ────────────────────────────────────────────────────

export function createCustomTools(): AgentTool<any>[] {
  const applyPatchTool: AgentTool<any> = {
    name: "apply_patch",
    label: "Apply Patch",
    description:
      "Apply a patch to create, update, move, or delete files. Uses a concise patch format with context lines for matching.",
    parameters: Type.Object({
      patch: Type.String({
        description:
          "The patch text in Codex patch format (*** Begin Patch ... *** End Patch)",
      }),
    }),
    // Note: apply_patch needs cwd which isn't available here.
    // Subagents use bash for patching instead.
    async execute(_toolCallId, params) {
      const result = applyPatch(params.patch, process.cwd());
      return {
        content: [{ type: "text", text: result }],
        details: {},
      };
    },
  };

  const readWebPage: AgentTool<any> = {
    name: "read_web_page",
    label: "Read Web Page",
    description: `Read contents of a web page.`,
    parameters: Type.Object({
      url: Type.String({ description: "URL to read" }),
      objective: Type.Optional(
        Type.String({
          description: "Research goal (returns relevant excerpts)",
        }),
      ),
      forceRefetch: Type.Optional(
        Type.Boolean({
          description: "Force live fetch",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const { text, url, hasObjective } = await fetchReadWebPage(
        params,
        signal,
      );
      return {
        content: [{ type: "text", text }],
        details: { url, hasObjective },
      };
    },
  };

  const searchWeb: AgentTool<any> = {
    name: "search_web",
    label: "Search Web",
    description: "Search the web for information.",
    parameters: Type.Object({
      objective: Type.String({
        description: "Research goal description",
      }),
      search_queries: Type.Optional(
        Type.Array(Type.String(), {
          description: "Keyword queries",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: "Max results (default: 5)",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const { text, results } = await fetchSearchWeb(params, signal);
      return {
        content: [{ type: "text", text }],
        details: {
          objective: params.objective,
          resultCount: results.length,
          results,
        },
      };
    },
  };

  return [applyPatchTool, readWebPage, searchWeb];
}
