---
name: how
description: Explain how something works in this codebase by exploring code and producing a clear architectural explanation. Optionally critique the architecture for issues.
---

# How

Explore the codebase to answer "how does X work?" questions. Produce clear architectural explanations at the level of a senior engineer onboarding onto a subsystem — enough to build a working mental model, not so much that it reads like annotated source code.

Two modes:

1. **Explain** (default) — explore the codebase and produce a clear explanation
2. **Critique** — explain first, then spawn multiple task agents to independently identify architectural issues

## Tool Mapping

This skill uses Pi's tools as follows:

- **File discovery**: `bash` with `find`, `ls`, or `rg` (ripgrep)
- **Symbol search**: `bash` with `rg`
- **Semantic search**: `finder` for complex multi-step code searches
- **File reading**: `read`
- **Subagents**: `task` — Pi does not support per-subagent model selection, so all tasks run on the session's model. For critique mode, this means you lose model diversity (the original design uses different models for independent perspectives). Compensate by giving each critic a distinct analytical lens in their prompt.

All subagent `task` prompts must include an explicit instruction: "Do NOT modify any files. This is a read-only exploration task."

## Explain Mode

### Step 1 — Understand the Question and Assess Complexity

Parse what the user is asking about. They might say:

- "How does message virtualization work?" — a subsystem
- "How do we handle billing for on-demand usage?" — a feature flow
- "How is the auth service structured?" — an architectural overview
- "Walk me through what happens when a user sends a message" — a runtime trace

Identify the scope. If it's ambiguous, make your best guess and state your interpretation before exploring. Don't ask — explore and let the user redirect if you're off.

**Assess complexity to decide the approach:**

- **Simple** (a single module, a small utility, a narrow question like "how does function X work"): Skip explorer agents entirely. The explainer agent explores and explains in a single pass. Go directly to Step 2b.
- **Complex** (a subsystem spanning multiple files/services, a cross-cutting feature, a full architectural overview): Spawn parallel explorer agents first, then hand off to the explainer. Go to Step 2a.

When in doubt, lean toward the simple path — you can always spawn explorers if the explainer hits a wall.

### Step 2a — Explore (complex questions only)

Decompose the question into 2-4 parallel exploration angles. Each angle should cover a distinct slice of the subsystem so the explorers aren't duplicating work. For example, if the question is "how does message virtualization work?", you might split into:

- Explorer 1: the data model and state management
- Explorer 2: the rendering pipeline and DOM interaction
- Explorer 3: the scroll/measurement infrastructure

The right decomposition depends on the question — use your judgment. For narrow questions, 2 explorers is fine. For broad subsystems, use up to 4.

Spawn all explorers as parallel `task` calls in a single message. Each explorer gets the same base prompt from `references/explorer-prompt.md`, plus a specific exploration angle telling it which slice to focus on. Each explorer should:

- Start broad: use `bash` with `find`/`rg` for relevant directories, search for key types/interfaces/class names
- Follow the thread: once you find an entry point, trace the call chain — callers, callees, data flow, type definitions
- Read the actual code, don't guess from file names
- Stop when you can describe the full path from input to output (or from trigger to effect) without hand-waving any step
- Note things that are surprising, non-obvious, or that a newcomer would get wrong

Each explorer returns structured findings: the components it found, the flow it traced, the files it read, and anything non-obvious. Overlap between explorers is fine — the explainer will reconcile.

Then proceed to Step 3.

### Step 2b — Direct Explain (simple questions)

Spawn a single `task` subagent that explores and explains in one pass. This agent does its own exploration (using `bash` with `find`/`rg`, `read`, and `finder`) and writes the explanation directly. Read `references/explainer-prompt.md` for the communication style and output format — the agent follows the same structure, it just doesn't have explorer findings as input.

Proceed to Step 4.

### Step 3 — Synthesize (complex questions only)

Once all explorers have returned, spawn a single `task` subagent to synthesize their findings into one coherent explanation. The explainer gets all explorers' findings and writes the human-facing explanation (see output format below). Read `references/explainer-prompt.md` for the full prompt template. The explainer reconciles overlapping findings, resolves contradictions, and weaves the separate slices into a unified picture.

### Step 4 — Present

Take the explainer's output and present it to the user. You may lightly edit for clarity or add context from the conversation, but don't substantially rewrite — the explainer agent's communication is the product.

### Output Format

The explanation should follow this structure, but adapt it to what makes sense for the question. Not every section is needed for every question.

**Overview** — 1-2 paragraphs. What is this thing, what does it do, why does it exist. Someone should be able to read this and decide whether they need to keep reading.

**Key Concepts** — The important types, services, or abstractions. Brief definition of each, not exhaustive — just the ones needed to understand the rest.

**How It Works** — The core of the explanation. Walk through the flow: what triggers it, what happens step by step, where does data go, what are the decision points. Use prose, not pseudocode. Reference specific files and functions so the reader can go look, but don't dump code blocks unless a specific snippet is genuinely necessary to understand the point.

**Where Things Live** — A brief map of the relevant files/directories. Not every file — just the ones someone would need to find to start working in this area.

**Gotchas** — Things that are non-obvious, surprising, or that would trip someone up. Historical context that explains why something looks weird. Known sharp edges.

## Critique Mode

Triggered when the user asks for architectural issues, problems, or improvements — not just understanding.

### Step 1 — Explain First

Run the full explain flow above (Steps 1-4). You need to understand the architecture before you can critique it.

### Step 2 — Spawn Critics

After the explanation is complete, spawn 3 architectural critics as parallel `task` calls in a single message.

Since Pi doesn't support per-subagent model selection (the original skill uses different LLM models for diversity of perspective), compensate by giving each critic a **distinct analytical focus**:

| Critic   | Focus                                               |
| -------- | --------------------------------------------------- |
| Critic A | Abstraction Fit + Boundary Discipline (from rubric) |
| Critic B | Data Model + Complexity vs. Value (from rubric)     |
| Critic C | Evolution Readiness + Consistency (from rubric)     |

Each critic is allowed to comment on anything, but their assigned lenses are where they should go deepest.

Read `references/critic-prompt.md` for the prompt template. Each critic gets:

1. The explanation from Step 1 (so they don't waste time re-exploring)
2. The relevant file paths (so they can read the actual code)
3. The architectural critique rubric from `references/critique-rubric.md`

### Step 3 — Lead Judgment

You're a pragmatic lead, not an aggregator.

Categorize findings:

- **Act on** — Architectural problems worth fixing now
- **Consider** — Real concerns, but the cost/benefit is unclear
- **Noted** — Valid observations, low priority
- **Dismissed** — Wrong, missing context, or style preference

Present the explanation first (from Step 1), then the critique verdict below it. The explanation should stand on its own — someone who just wants to understand the system shouldn't have to wade through critique.
