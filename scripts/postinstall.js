#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Opt-out
if (process.env.OH_MY_HARNESS_LOOP_SKIP_POSTINSTALL === "1") {
  process.exit(0);
}

// Dev-install detection: npm sets INIT_CWD to the user's cwd at start of `npm install`.
// If INIT_CWD equals our own package dir (we are being dev-installed in our own repo),
// or if INIT_CWD is missing (some package managers don't set it), skip.
const initCwd = process.env.INIT_CWD;
if (!initCwd) {
  process.exit(0);
}

// __dirname points to the installed package dir (e.g. node_modules/oh-my-harness-loop/scripts/)
// If INIT_CWD is the same as our package parent (going up from scripts/ to package root),
// we're in dev-install mode (running npm install inside this repo itself).
const packageRoot = join(__dirname, "..");
if (initCwd === packageRoot) {
  process.exit(0);
}

const SHIMS = [
  {
    relPath: ".opencode/command/harness-on.md",
    content:
      "---\ndescription: Start the harness gate loop for the current feature\n---\n\n$ARGUMENTS\n",
  },
  {
    relPath: ".opencode/command/harness-off.md",
    content: "---\ndescription: Cancel the active harness gate loop\n---\n",
  },
];

try {
  let created = 0;
  let skipped = 0;
  for (const shim of SHIMS) {
    const dest = join(initCwd, shim.relPath);
    if (existsSync(dest)) {
      skipped += 1;
      continue;
    }
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, shim.content, "utf-8");
    created += 1;
  }
  if (created > 0) {
    console.log(
      "[oh-my-harness-loop] Created " +
        created +
        " slash-command shim(s) in .opencode/command/ (" +
        skipped +
        " already present). Restart OpenCode to use /harness-on and /harness-off."
    );
  }
} catch (err) {
  // Never break the install
  console.warn(
    "[oh-my-harness-loop] postinstall: could not create slash-command shims: " +
      (err && err.message ? err.message : String(err)) +
      ". You can create them manually — see README."
  );
}
process.exit(0);
