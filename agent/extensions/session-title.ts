/**
 * Session Titles Extension
 *
 * Automatically generates a short session title from the first prompt and keeps
 * the terminal tab title updated with status indicators.
 *
 * - Kicks off title generation immediately on the first prompt
 * - Does not block the main agent turn while generating the title
 * - Shows ⏳ while the agent is working
 * - Shows 🔔 when the agent is done
 * - Persists the generated title via pi.setSessionName()
 */

import { complete, getModel } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const TITLE_PROMPT = `Generate a very short title (3-6 words max) for this conversation based on the user's request.
Return ONLY the title text, nothing else. No quotes, no prefix, no punctuation at the end.
Examples of good titles: "Fix auth middleware bug", "Add dark mode toggle", "Refactor database layer", "Setup CI pipeline"`;

type TitleIndicator = "⏳" | "🔔" | undefined;
type TextContent = { type: "text"; text: string };
type ModelWithAuth = {
  model: NonNullable<ReturnType<typeof getModel>>;
  apiKey: string;
  headers: Record<string, string> | undefined;
};

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function sanitizeTitle(title: string): string {
  return title
    .replace(/^["']+|["']+$/g, "")
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getBaseTitle(pi: ExtensionAPI): string {
  const name = pi.getSessionName()?.trim();
  if (name) {
    return `π | ${name}`;
  }

  return "π";
}

function renderTitle(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  indicator: TitleIndicator,
): void {
  if (!ctx.hasUI) {
    return;
  }

  const baseTitle = getBaseTitle(pi);
  ctx.ui.setTitle(indicator ? `${indicator} ${baseTitle}` : baseTitle);
}

async function pickTitleModel(
  ctx: ExtensionContext,
): Promise<ModelWithAuth | null> {
  const candidates = [
    ["google", "gemini-2.5-flash"],
    ["openai", "gpt-4.1-nano"],
    ["openai", "gpt-4.1-mini"],
    ["anthropic", "claude-haiku-4-5"],
  ] as const;

  for (const [provider, id] of candidates) {
    const model = getModel(provider, id);
    if (!model) {
      continue;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth?.ok || !auth.apiKey) {
      continue;
    }

    return {
      model,
      apiKey: auth.apiKey,
      headers: auth.headers,
    };
  }

  if (!ctx.model) {
    return null;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth?.ok || !auth.apiKey) {
    return null;
  }

  return {
    model: ctx.model,
    apiKey: auth.apiKey,
    headers: auth.headers,
  };
}

export default function (pi: ExtensionAPI) {
  let titleGenerated = false;
  let titleGenerationInFlight = false;
  let currentIndicator: TitleIndicator = undefined;
  let generationRunId = 0;

  function invalidatePendingGeneration(): void {
    generationRunId += 1;
    titleGenerationInFlight = false;
  }

  function resetSessionState(ctx: ExtensionContext): void {
    invalidatePendingGeneration();
    titleGenerated = !!pi.getSessionName();
    currentIndicator = undefined;
    renderTitle(pi, ctx, currentIndicator);
  }

  async function generateTitle(
    prompt: string,
    runId: number,
    ctx: ExtensionContext,
  ): Promise<void> {
    try {
      const modelWithAuth = await pickTitleModel(ctx);
      if (!modelWithAuth) {
        return;
      }

      const response = await complete(
        modelWithAuth.model,
        {
          messages: [
            {
              role: "user" as const,
              content: [
                {
                  type: "text" as const,
                  text: `${TITLE_PROMPT}\n\nUser message:\n${prompt}`,
                },
              ],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: modelWithAuth.apiKey,
          headers: modelWithAuth.headers,
          maxTokens: 30,
        },
      );

      const title = sanitizeTitle(
        response.content
          .filter((content): content is TextContent => content.type === "text")
          .map((content) => content.text)
          .join(""),
      );

      if (!title || runId !== generationRunId) {
        return;
      }

      pi.setSessionName(title);
      titleGenerated = true;
      renderTitle(pi, ctx, currentIndicator);
    } catch {
      // Best effort only.
    } finally {
      if (runId === generationRunId) {
        titleGenerationInFlight = false;
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    resetSessionState(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    resetSessionState(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    currentIndicator = "⏳";
    renderTitle(pi, ctx, currentIndicator);

    // If titleGenerated is true but the session has no name, a low-level
    // session switch happened (e.g. handoff tool path) without emitting
    // session_switch. Reset so we generate a title for the new session.
    if (titleGenerated && !pi.getSessionName()) {
      titleGenerated = false;
    }

    if (titleGenerated || titleGenerationInFlight) {
      return;
    }

    const prompt = normalizePrompt(event.prompt);
    if (!prompt) {
      return;
    }

    titleGenerationInFlight = true;
    const runId = ++generationRunId;
    void generateTitle(prompt, runId, ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    currentIndicator = "🔔";
    renderTitle(pi, ctx, currentIndicator);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setTitle("");
    }
  });

  pi.registerCommand("title", {
    description:
      "Set, show, or clear session title (usage: /title [name] or /title --clear)",
    handler: async (args, ctx) => {
      const trimmed = args.trim();

      invalidatePendingGeneration();

      if (trimmed === "--clear") {
        pi.setSessionName("");
        titleGenerated = false;
        currentIndicator = undefined;
        renderTitle(pi, ctx, currentIndicator);
        if (ctx.hasUI) {
          ctx.ui.notify("Session title cleared", "info");
        }
        return;
      }

      if (trimmed) {
        pi.setSessionName(trimmed);
        titleGenerated = true;
        renderTitle(pi, ctx, currentIndicator);
        if (ctx.hasUI) {
          ctx.ui.notify(`Session title: ${trimmed}`, "info");
        }
        return;
      }

      const current = pi.getSessionName();
      if (ctx.hasUI) {
        ctx.ui.notify(
          current ? `Session title: ${current}` : "No title set",
          "info",
        );
      }
    },
  });
}
