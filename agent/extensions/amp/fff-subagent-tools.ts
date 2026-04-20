/**
 * FFF-powered tools for subagents.
 *
 * Creates standalone AgentTool instances that wrap FffRuntime directly,
 * without depending on the pi ExtensionAPI. This lets subagents use
 * fff-enhanced read, grep, find_files, and fff_multi_grep.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createReadTool, createGrepTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { FffRuntime } from "pi-fff/src/fff.ts";

// Shared runtime cache keyed by cwd
const runtimeCache = new Map<string, FffRuntime>();

function getOrCreateRuntime(cwd: string): FffRuntime {
  let runtime = runtimeCache.get(cwd);
  if (!runtime) {
    runtime = new FffRuntime(cwd);
    runtimeCache.set(cwd, runtime);
    // Fire-and-forget warm
    void runtime.warm(2000);
  }
  return runtime;
}

function textResult<T>(text: string, details: T) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

/**
 * Build fff-powered AgentTool instances for use in subagents.
 */
export function createFffSubagentTools(cwd: string): AgentTool<any>[] {
  const runtime = getOrCreateRuntime(cwd);

  // ── fff-enhanced read ──────────────────────────────────────────────────
  const baseRead = createReadTool(cwd);
  const fffRead: AgentTool<any> = {
    name: "read",
    label: "read",
    description: `${baseRead.description} Accepts approximate file paths and resolves them with fff before reading.`,
    parameters: baseRead.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      const resolution = await runtime.resolvePath(params.path, {
        allowDirectory: false,
        limit: 8,
      });

      if (resolution.isErr()) {
        // Fall back to built-in read on resolution failure
        return baseRead.execute(toolCallId, params, signal, onUpdate);
      }

      const resolved = resolution.value;
      void runtime.trackQuery(params.path, resolved.absolutePath);

      // Apply location hints from fff resolution
      let offset = params.offset;
      let limit = params.limit;
      if (offset === undefined && resolved.location) {
        if (resolved.location.type === "line") {
          offset = resolved.location.line;
          limit = limit ?? 80;
        } else if (resolved.location.type === "position") {
          offset = resolved.location.line;
          limit = limit ?? 80;
        } else if (resolved.location.type === "range") {
          const rangeSize = Math.max(
            1,
            resolved.location.end.line - resolved.location.start.line + 1,
          );
          offset = resolved.location.start.line;
          limit = limit ?? Math.max(rangeSize, 20);
        }
      }

      return baseRead.execute(
        toolCallId,
        { ...params, path: resolved.absolutePath, offset, limit },
        signal,
        onUpdate,
      );
    },
  };

  // ── fff-enhanced grep ──────────────────────────────────────────────────
  const baseGrep = createGrepTool(cwd);

  const grepSchema = Type.Object({
    pattern: Type.String({ description: "Search pattern" }),
    path: Type.Optional(
      Type.String({ description: "Optional exact or fuzzy file/folder scope" }),
    ),
    glob: Type.Optional(
      Type.String({ description: "Optional glob filter such as *.ts" }),
    ),
    constraints: Type.Optional(
      Type.String({
        description:
          "Optional native FFF constraints such as *.ts !tests/ src/",
      }),
    ),
    ignoreCase: Type.Optional(
      Type.Boolean({
        description: "Case-insensitive search (default: smart case)",
      }),
    ),
    literal: Type.Optional(
      Type.Boolean({
        description: "Treat pattern as literal string instead of regex",
      }),
    ),
    context: Type.Optional(
      Type.Number({
        description: "Context lines before and after each match",
      }),
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of matches to return (default: 100)",
      }),
    ),
  });

  const fffGrep: AgentTool<any> = {
    name: "grep",
    label: "grep",
    description: `${baseGrep.description} Uses fff for content search and can resolve approximate file or folder scopes.`,
    parameters: grepSchema,
    async execute(toolCallId, params, signal, onUpdate) {
      const builtinParams = {
        pattern: params.pattern,
        path: params.path,
        glob: params.glob,
        ignoreCase: params.ignoreCase,
        literal: params.literal,
        context: params.context,
        limit: params.limit,
      };

      // Determine search mode
      const mode =
        params.literal === false ? ("regex" as const) : ("plain" as const);
      const pattern =
        params.ignoreCase === true
          ? params.pattern.toLowerCase()
          : params.pattern;

      const result = await runtime.grepSearch({
        pattern,
        mode,
        pathQuery: params.path,
        glob: params.glob,
        constraints: params.constraints,
        context: params.context,
        limit: params.limit,
        includeCursorHint: false,
      });

      if (result.isErr()) {
        // Fall back to built-in grep on fff failure
        return baseGrep.execute(toolCallId, builtinParams, signal, onUpdate);
      }

      return textResult(result.value.formatted, {
        resolvedScope: result.value.scope?.relativePath,
      });
    },
  };

  // ── find_files ─────────────────────────────────────────────────────────
  const fffFindFiles: AgentTool<any> = {
    name: "find_files",
    label: "Find Files",
    description: "Browse ranked file candidates for a fuzzy query using fff.",
    parameters: Type.Object({
      query: Type.String({ description: "Fuzzy file query" }),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default: 20)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await runtime.findFiles({
        query: params.query,
        limit: params.limit,
      });

      if (result.isErr()) {
        return textResult(`find_files error: ${result.error.message}`, {});
      }

      return textResult(result.value.formatted, {
        totalMatched: result.value.totalMatched,
        totalFiles: result.value.totalFiles,
      });
    },
  };

  // ── fff_multi_grep ─────────────────────────────────────────────────────
  const fffMultiGrep: AgentTool<any> = {
    name: "fff_multi_grep",
    label: "FFF Multi Grep",
    description:
      "Search file contents for any of multiple literal patterns using fff multi-grep.",
    parameters: Type.Object({
      patterns: Type.Array(Type.String({ description: "Literal pattern" }), {
        minItems: 1,
      }),
      path: Type.Optional(
        Type.String({
          description: "Optional exact or fuzzy file/folder scope",
        }),
      ),
      glob: Type.Optional(
        Type.String({ description: "Optional glob filter such as *.ts" }),
      ),
      constraints: Type.Optional(
        Type.String({
          description:
            "Optional native FFF constraints such as *.ts !tests/ src/",
        }),
      ),
      context: Type.Optional(
        Type.Number({
          description: "Context lines before and after each match",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of matches to return (default: 60)",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await runtime.multiGrepSearch({
        patterns: params.patterns,
        pathQuery: params.path,
        glob: params.glob,
        constraints: params.constraints,
        context: params.context,
        limit: params.limit ?? 60,
        includeCursorHint: false,
        outputMode: "files_with_matches",
      });

      if (result.isErr()) {
        return textResult(`fff_multi_grep error: ${result.error.message}`, {});
      }

      return textResult(result.value.formatted, {
        resolvedScope: result.value.scope?.relativePath,
      });
    },
  };

  return [fffRead, fffGrep, fffFindFiles, fffMultiGrep];
}
