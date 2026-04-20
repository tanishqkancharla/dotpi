#!/usr/bin/env node
/**
 * Terminal viewer for explain_diff.md files.
 * Watches the file for changes, expands `!\`git diff ...\`` commands,
 * and renders the result with ANSI colors in the terminal.
 *
 * Usage: node explain-diff-viewer.mjs [path] [--cwd dir]
 */

import { execSync } from "node:child_process";
import { readFileSync, watchFile, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let filePath = "/tmp/session-diff-report.md";
let cwd = process.cwd();

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cwd" && args[i + 1]) {
    cwd = args[++i];
  } else if (!args[i].startsWith("-")) {
    filePath = args[i];
  }
}

filePath = resolve(filePath);

// ANSI helpers
const reset = "\x1b[0m";
const bold = (s) => `\x1b[1m${s}${reset}`;
const dim = (s) => `\x1b[2m${s}${reset}`;
const italic = (s) => `\x1b[3m${s}${reset}`;
const green = (s) => `\x1b[32m${s}${reset}`;
const red = (s) => `\x1b[31m${s}${reset}`;
const cyan = (s) => `\x1b[36m${s}${reset}`;
const magenta = (s) => `\x1b[35m${s}${reset}`;
const yellow = (s) => `\x1b[33m${s}${reset}`;
const bgDim = (s) => `\x1b[48;5;236m${s}${reset}`;

function expandCommandDiffs(content) {
  // Replace !`git diff ...` lines with the actual output wrapped in ```diff
  return content.replace(/^!`(git diff[^`]*)`\s*$/gm, (_match, cmd) => {
    try {
      const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: 10000 });
      if (output.trim()) {
        return "```diff\n" + output.trimEnd() + "\n```";
      }
      return dim("(no diff output)");
    } catch {
      return dim(`(failed to run: ${cmd})`);
    }
  });
}

function colorDiffLine(line) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return bold(dim(line));
  }
  if (line.startsWith("+")) return green(line);
  if (line.startsWith("-")) return red(line);
  if (line.startsWith("@@")) return cyan(line);
  if (line.startsWith("diff --git")) return bold(yellow(line));
  return dim(line);
}

function renderMarkdown(content) {
  const lines = content.split("\n");
  const output = [];
  let inCodeBlock = false;
  let codeLang = "";

  for (const line of lines) {
    // Fenced code block boundaries
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
        output.push(
          dim("─".repeat(Math.min(process.stdout.columns || 80, 80))),
        );
        continue;
      } else {
        inCodeBlock = false;
        codeLang = "";
        output.push(
          dim("─".repeat(Math.min(process.stdout.columns || 80, 80))),
        );
        continue;
      }
    }

    // Inside code block
    if (inCodeBlock) {
      if (codeLang === "diff") {
        output.push(colorDiffLine(line));
      } else {
        output.push(bgDim(line));
      }
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        output.push("");
        output.push(bold(magenta("━━━ " + text + " ━━━")));
        output.push("");
      } else if (level === 2) {
        output.push("");
        output.push(bold(cyan("── " + text)));
        output.push("");
      } else {
        output.push(bold(text));
      }
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      output.push(dim("─".repeat(Math.min(process.stdout.columns || 80, 40))));
      continue;
    }

    // List items
    if (/^\s*[-*]\s/.test(line)) {
      let rendered = line.replace(/^(\s*)([-*])(\s)/, "$1" + cyan("•") + "$3");
      rendered = rendered.replace(/\*\*([^*]+)\*\*/g, (_m, t) => bold(t));
      rendered = rendered.replace(/\*([^*]+)\*/g, (_m, t) => italic(t));
      rendered = rendered.replace(/`([^`]+)`/g, (_m, t) => bgDim(t));
      output.push(rendered);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      output.push(dim("│ ") + italic(line.slice(2)));
      continue;
    }

    // Inline formatting
    let rendered = line;
    rendered = rendered.replace(/\*\*([^*]+)\*\*/g, (_m, t) => bold(t));
    rendered = rendered.replace(/\*([^*]+)\*/g, (_m, t) => italic(t));
    rendered = rendered.replace(/`([^`]+)`/g, (_m, t) => bgDim(t));

    output.push(rendered);
  }

  return output.join("\n");
}

function render() {
  if (!existsSync(filePath)) return;

  try {
    const raw = readFileSync(filePath, "utf-8");
    if (!raw.trim()) return;

    const expanded = expandCommandDiffs(raw);
    const rendered = renderMarkdown(expanded);

    // Clear screen and render
    process.stdout.write("\x1b[2J\x1b[H");
    process.stdout.write(rendered + "\n\n");
    process.stdout.write(dim(`── watching ${filePath} ──`) + "\n");
  } catch (e) {
    process.stdout.write(
      `\x1b[2J\x1b[H${red("Error rendering:")} ${e.message}\n`,
    );
  }
}

// Create file if it doesn't exist
if (!existsSync(filePath)) {
  writeFileSync(filePath, "", "utf-8");
}

// Initial render
render();

// Watch for changes (poll every 500ms, reliable across platforms)
watchFile(filePath, { interval: 500 }, () => {
  render();
});

process.on("SIGINT", () => {
  process.exit(0);
});
