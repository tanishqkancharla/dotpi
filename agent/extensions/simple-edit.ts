/**
 * Custom edit tool that replaces Pi's built-in edit tool.
 *
 * Uses a simpler flat parameter format (file_path, old_string, new_string)
 * instead of the built-in's { path, edits: [...] } array format.
 *
 * Motivation: The array-of-edits JSON format occasionally causes models to
 * emit malformed JSON (e.g., mixing XML parameter syntax mid-JSON), because
 * the nested structure is harder to serialize correctly in one shot.
 * A flat parameter set is more reliable for model output.
 */

import type {
  ExtensionAPI,
  EditToolDetails,
} from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
// Internal import — not in the public exports; use absolute path since jiti
// misresolves bare-specifier subpaths through the package's main export.
import {
  generateDiffString,
  normalizeToLF,
  detectLineEnding,
  restoreLineEndings,
  stripBom,
  applyEditsToNormalizedContent,
} from "/Users/tanishqkancharla/.nvm/versions/node/v23.7.0/lib/node_modules/@mariozechner/pi-coding-agent/dist/core/tools/edit-diff.js";
import { Type } from "@sinclair/typebox";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "edit",
    label: "Edit",
    description: `Performs exact string replacements in files.

Usage rules:
- You must use the Read tool at least once before editing a file
- Preserve exact indentation (tabs/spaces) from the file
- Prefer editing existing files over creating new ones
- The edit will FAIL if old_string is not unique in the file — provide more surrounding context to make it unique, or use replace_all`,
    promptSnippet: "Make precise file edits with exact text replacement",
    promptGuidelines: [
      "Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
      "Use read to examine files before editing",
      "Use edit for precise changes (old_string must match exactly)",
      "Keep old_string as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
      "Use write only for new files or complete rewrites.",
    ],
    parameters: Type.Object({
      file_path: Type.String({
        description: "The absolute path to the file to modify",
      }),
      old_string: Type.String({
        description: "The text to replace (must be exact match)",
      }),
      new_string: Type.String({
        description:
          "The text to replace it with (must differ from old_string)",
      }),
      replace_all: Type.Optional(
        Type.Boolean({
          description: "Replace all occurrences of old_string (default: false)",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const { old_string, new_string, replace_all } = params;
      // Strip leading @ (some models add it)
      const filePath = resolve(ctx.cwd, params.file_path.replace(/^@/, ""));

      // Validate inputs
      if (old_string === new_string) {
        throw new Error("old_string and new_string must be different");
      }

      // Check file exists
      try {
        await access(filePath);
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }

      return withFileMutationQueue(filePath, async () => {
        const raw = await readFile(filePath, "utf8");
        const { bom, text: noBomContent } = stripBom(raw);
        const lineEnding = detectLineEnding(noBomContent);
        const normalizedContent = normalizeToLF(noBomContent);

        // Build edits array
        if (replace_all) {
          // For replace_all, we need to handle it ourselves since
          // applyEditsToNormalizedContent checks for uniqueness
          const occurrences = normalizedContent.split(old_string).length - 1;
          if (occurrences === 0) {
            throw new Error(
              `old_string not found in ${filePath}. Make sure it matches the file content exactly, including whitespace and indentation.`,
            );
          }

          const newContent = normalizedContent
            .split(old_string)
            .join(new_string);
          const finalContent = bom + restoreLineEndings(newContent, lineEnding);
          await writeFile(filePath, finalContent, "utf8");

          const { diff, firstChangedLine } = generateDiffString(
            normalizedContent,
            newContent,
          );
          const details: EditToolDetails = { diff, firstChangedLine };
          const relativePath = filePath.startsWith(ctx.cwd + "/")
            ? filePath.slice(ctx.cwd.length + 1)
            : filePath;

          return {
            content: [
              {
                type: "text" as const,
                text: `Successfully replaced ${occurrences} occurrence(s) in ${relativePath}.`,
              },
            ],
            details,
          };
        } else {
          // Single edit — use Pi's applyEditsToNormalizedContent for fuzzy matching
          const edits = [{ oldText: old_string, newText: new_string }];
          const { newContent } = applyEditsToNormalizedContent(
            normalizedContent,
            edits,
            filePath,
          );
          const finalContent = bom + restoreLineEndings(newContent, lineEnding);
          await writeFile(filePath, finalContent, "utf8");

          const { diff, firstChangedLine } = generateDiffString(
            normalizedContent,
            newContent,
          );
          const details: EditToolDetails = { diff, firstChangedLine };
          const relativePath = filePath.startsWith(ctx.cwd + "/")
            ? filePath.slice(ctx.cwd.length + 1)
            : filePath;

          return {
            content: [
              {
                type: "text" as const,
                text: `Successfully replaced text in ${relativePath}.`,
              },
            ],
            details,
          };
        }
      });
    },
  });
}
