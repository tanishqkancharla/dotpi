/**
 * Look At Extension (Gemini API)
 *
 * Provides a tool for analyzing local files (PDFs, images, media) using Gemini's
 * multimodal capabilities. Useful when the standard Read tool can't interpret
 * binary content.
 *
 * API key is fetched from GCP Secret Manager via gcloud CLI (cached in memory).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SERVICE_ACCOUNT_KEY_PATH =
  "/Users/tanishqkancharla/.pi/agent/gcloud-sa-key.json";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function readFileAsBase64(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

let _geminiApiKey: string | undefined;

function getGcloudEnv(): NodeJS.ProcessEnv {
  if (!existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
    return process.env;
  }

  return {
    ...process.env,
    GOOGLE_APPLICATION_CREDENTIALS: SERVICE_ACCOUNT_KEY_PATH,
  };
}

function getGeminiApiKey(): string {
  if (_geminiApiKey) return _geminiApiKey;

  if (process.env.GEMINI_API_KEY) {
    _geminiApiKey = process.env.GEMINI_API_KEY;
    return _geminiApiKey;
  }

  try {
    _geminiApiKey = execSync(
      "gcloud secrets versions access latest --secret=gemini-api-key --project=saffron-health",
      { encoding: "utf-8", env: getGcloudEnv() },
    ).trim();
    return _geminiApiKey;
  } catch (err: any) {
    throw new Error(
      `Failed to get Gemini API key. Set GEMINI_API_KEY env var or ensure ${SERVICE_ACCOUNT_KEY_PATH} is valid: ${err.message}`,
    );
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "read_media",
    label: "Read Media",
    description: `Extract/analyze info from local files (PDFs, images, media).`,
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path to the file",
      }),
      objective: Type.String({
        description: "Analysis goal",
      }),
      context: Type.String({
        description: "Broader goal and background",
      }),
      referenceFiles: Type.Optional(
        Type.Array(Type.String(), {
          description: "Reference files for comparison",
        }),
      ),
    }),

    renderCall(args: any, theme: any, context: any) {
      const relativePath = path.relative(context.cwd, args.path);
      let text = theme.fg("toolTitle", theme.bold("read_media "));
      text += theme.fg("toolTitle", theme.bold(relativePath));
      text += theme.fg("dim", " - ");
      text += theme.fg("muted", args.objective);
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal) {
      const apiKey = getGeminiApiKey();
      const workspaceRoot = process.cwd();

      const resolvePath = (p: string) => {
        // Strip leading @ (some models add it)
        const cleaned = p.startsWith("@") ? p.slice(1) : p;
        return path.isAbsolute(cleaned)
          ? cleaned
          : path.join(workspaceRoot, cleaned);
      };

      const mainPath = resolvePath(params.path);
      const mainMime = getMimeType(mainPath);
      const mainBase64 = await readFileAsBase64(mainPath);

      type Part =
        | { text: string }
        | { inline_data: { mime_type: string; data: string } };
      const parts: Part[] = [];

      let prompt = `Objective: ${params.objective}\n\nContext: ${params.context}\n\n`;

      if (params.referenceFiles && params.referenceFiles.length > 0) {
        prompt += `You are analyzing the main file and comparing it with ${params.referenceFiles.length} reference file(s).\n\n`;
        prompt += `Main file: ${params.path}\n`;
        prompt += `Reference files: ${params.referenceFiles.join(", ")}\n\n`;
      } else {
        prompt += `File being analyzed: ${params.path}\n\n`;
      }

      prompt += `Instructions:
- Focus on the specific objective - do not provide comprehensive summaries unless requested
- Be specific and cite locations when possible (page numbers, sections, coordinates)
- For images: describe visual elements that matter for the objective
- For comparisons: clearly contrast differences/similarities as requested
- Be concise and direct`;

      parts.push({ text: prompt });

      parts.push({
        inline_data: {
          mime_type: mainMime,
          data: mainBase64,
        },
      });

      if (params.referenceFiles && params.referenceFiles.length > 0) {
        for (const refFile of params.referenceFiles) {
          const refPath = resolvePath(refFile);
          const refMime = getMimeType(refPath);
          const refBase64 = await readFileAsBase64(refPath);
          parts.push({
            inline_data: {
              mime_type: refMime,
              data: refBase64,
            },
          });
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }

      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                temperature: 0.1,
              },
            }),
          },
        );
      } catch (err: any) {
        throw new Error(`Gemini API request failed: ${err.message}`);
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error("No response from Gemini API");
      }

      const text = candidate.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("No text content in Gemini response");
      }

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text }];

      // Include image preview for supported image types
      const ext = path.extname(mainPath).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
        content.push({
          type: "image",
          data: mainBase64,
          mimeType: mainMime,
        });
      }

      return {
        content,
        details: {
          path: params.path,
          objective: params.objective,
          referenceFiles: params.referenceFiles,
        },
      };
    },
  });
}
