## Agent Modes

Pi uses an "amp" extension that manages **modes** — named configurations that set the model, thinking level, and active tool list. Mode files live in `~/.pi/agent/agents/*.md` as YAML frontmatter.

The current mode is persisted in `~/.pi/agent/current-mode`. The primary modes are:

- **smart** (`smart.md`) — Anthropic Claude Opus, medium thinking
- **deep** (`deep.md`) — OpenAI GPT-5.4, high thinking

Each mode has an explicit `tools:` list. When a mode is activated, `setActiveTools()` is called with that list, so **only the listed tools are available to the LLM**. Any extension-registered tool not in the active mode's tools list will be silently filtered out.

### Adding a new tool to modes

When you register a new tool via an extension, you must also add it to the `tools:` list in each mode file where it should be available:

```
~/.pi/agent/agents/smart.md
~/.pi/agent/agents/deep.md
```

Other mode files (`finder.md`, `librarian.md`, `oracle.md`, `task.md`) are for subagents and typically don't need custom tools.
