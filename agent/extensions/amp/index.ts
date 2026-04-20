/**
 * Amp — unified Pi extension.
 *
 * Consolidates: subagents, modes, web tools, custom UI, and skill discovery.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerModes } from "./modes.js";
import { registerSkills } from "./skills.js";
import { registerSubagents } from "./subagents.js";
import { registerTools } from "./tools.js";
import { registerUI } from "./ui.js";

export default function amp(pi: ExtensionAPI) {
  registerTools(pi);
  registerSubagents(pi);
  registerModes(pi);
  registerUI(pi);
  registerSkills(pi);
}
