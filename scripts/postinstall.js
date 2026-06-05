#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Opt-out
if (process.env.OH_MY_HARNESS_SKIP_POSTINSTALL === "1") {
  process.exit(0);
}

// Dev-install detection: npm sets INIT_CWD to the user's cwd at start of `npm install`.
// If INIT_CWD equals our own package dir (we are being dev-installed in our own repo),
// or if INIT_CWD is missing (some package managers don't set it), skip.
const rawInitCwd = process.env.INIT_CWD;
if (!rawInitCwd) {
  process.exit(0);
}

// If the user ran `npm install` from inside a `.opencode/` subdir (e.g. they keep
// a separate package.json there), INIT_CWD points at `.opencode/` itself. Without
// this guard we'd create `.opencode/.opencode/commands/…`. Walk up to the parent.
const initCwd =
  basename(rawInitCwd) === ".opencode" ? dirname(rawInitCwd) : rawInitCwd;

// __dirname points to the installed package dir (e.g. node_modules/oh-my-harness/scripts/)
// If INIT_CWD is the same as our package parent (going up from scripts/ to package root),
// we're in dev-install mode (running npm install inside this repo itself).
const packageRoot = join(__dirname, "..");
if (initCwd === packageRoot) {
  process.exit(0);
}

const SHIMS = [
  {
    relPath: ".opencode/commands/harness-on.md",
    content:
      "---\ndescription: Start the harness gate loop for the current feature\n---\n\n$ARGUMENTS\n",
  },
  {
    relPath: ".opencode/commands/harness-off.md",
    content: "---\ndescription: Cancel the active harness gate loop\n---\n\n$ARGUMENTS\n",
  },
  {
    relPath: ".opencode/commands/harness-init.md",
    content:
      "---\ndescription: Bootstrap harness setup in the current project (interactive)\n---\n",
  },
  {
    relPath: ".opencode/commands/harness-check.md",
    content:
      "---\ndescription: Manually run a single gate via the configured runner (read-only)\n---\n\n$ARGUMENTS\n",
  },
  {
    relPath: ".opencode/commands/harness-team.md",
    content:
      "---\ndescription: Team Architecture Factory — generate agent team + skills from domain description\n---\n\n$ARGUMENTS\n",
  },
];

// Legacy filenames that v2026.6.0303 wrote to the wrong dirs. We delete ONLY
// these exact filenames (never anything user-authored). Removing the parent
// `command/` dir is only done if it's empty after our cleanup. The nested
// `.opencode/.opencode/` tree is only removed if it contains nothing but our
// own legacy shims.
const LEGACY_SHIM_FILES = ["harness-on.md", "harness-off.md"];

function migrateLegacyLayout(rootDir) {
  const removed = [];
  const legacyDirs = [
    join(rootDir, ".opencode/command"),
    join(rootDir, ".opencode/.opencode/command"),
  ];

  for (const dir of legacyDirs) {
    if (!existsSync(dir)) continue;
    for (const name of LEGACY_SHIM_FILES) {
      const file = join(dir, name);
      if (existsSync(file)) {
        unlinkSync(file);
        removed.push(file);
      }
    }
    if (readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const nestedOpencode = join(rootDir, ".opencode/.opencode");
  if (existsSync(nestedOpencode) && readdirSync(nestedOpencode).length === 0) {
    rmSync(nestedOpencode, { recursive: true, force: true });
  }

  return removed;
}

try {
  let created = 0;
  let skipped = 0;
  const migrated = migrateLegacyLayout(initCwd);
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
  if (migrated.length > 0) {
    console.log(
      "[oh-my-harness] Migrated " +
        migrated.length +
        " legacy shim file(s) from v2026.6.0303 layout (.opencode/command/) — see commit history for details."
    );
  }
  if (created > 0) {
    console.log(
      "[oh-my-harness] Created " +
        created +
        " slash-command shim(s) in " +
        join(initCwd, ".opencode/commands") +
        " (" +
        skipped +
        " already present). Restart OpenCode to use /harness-on, /harness-off, /harness-init, /harness-check, /harness-team."
    );
  }
  // --- Skill symlink: .opencode/skills/team-architecture-factory → package's skills/ ---
  const skillName = "team-architecture-factory";
  const skillDest = join(initCwd, ".opencode/skills", skillName);
  const skillSource = join(packageRoot, "skills", skillName);

  if (existsSync(skillSource)) {
    mkdirSync(join(initCwd, ".opencode/skills"), { recursive: true });

    // Compute relative path from symlink location to target
    const relTarget = relative(dirname(skillDest), skillSource);

    // Use lstatSync (does NOT follow symlinks) so we detect dangling symlinks
    // whose inode exists on disk even though their target is gone.
    let destStat = null;
    try { destStat = lstatSync(skillDest); } catch (_) { /* does not exist */ }

    if (destStat) {
      const isSymlink = destStat.isSymbolicLink();
      if (isSymlink && readlinkSync(skillDest) === relTarget) {
        // Already correct (also covers a previously-dangling symlink that now
        // points to the right relative target — nothing to do)
      } else if (isSymlink) {
        // Symlink exists (dangling or pointing elsewhere) — replace it
        unlinkSync(skillDest);
        symlinkSync(relTarget, skillDest);
        console.log(
          "[oh-my-harness] Updated skill symlink: .opencode/skills/" + skillName
        );
      }
      // If it's a real directory (user-authored), don't touch it
    } else {
      symlinkSync(relTarget, skillDest);
      console.log(
        "[oh-my-harness] Created skill symlink: .opencode/skills/" +
          skillName +
          " → " +
          relTarget
      );
    }
  }
} catch (err) {
  // Never break the install
  console.warn(
    "[oh-my-harness] postinstall: could not complete setup: " +
      (err && err.message ? err.message : String(err)) +
      ". You can create shims/symlinks manually — see README."
  );
}
process.exit(0);
