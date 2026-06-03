import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  appendFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface HarnessInitContext {
  projectRoot: string;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
  injectMessage(text: string): Promise<void>;
}

interface CopyEntry {
  source: string;
  dest: string;
  executable?: boolean;
}

interface AppendEntry {
  source: string;
  dest: string;
  marker: string;
}

function resolveTemplatesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "templates", "init");
}

export async function handleHarnessInit(ctx: HarnessInitContext): Promise<void> {
  const templatesRoot = resolveTemplatesRoot();
  if (!existsSync(templatesRoot)) {
    ctx.showToast(
      `❌ Template directory not found at ${templatesRoot}. Re-install the package.`,
      "error"
    );
    return;
  }

  const copies: CopyEntry[] = [
    {
      source: join(templatesRoot, ".opencode/harness.config.json"),
      dest: join(ctx.projectRoot, ".opencode/harness.config.json"),
    },
    {
      source: join(templatesRoot, "scripts/harness-check.sh"),
      dest: join(ctx.projectRoot, "scripts/harness-check.sh"),
      executable: true,
    },
    {
      source: join(templatesRoot, "docs/harness/gates/pre-work.md"),
      dest: join(ctx.projectRoot, "docs/harness/gates/pre-work.md"),
    },
    {
      source: join(templatesRoot, "docs/harness/gates/in-progress.md"),
      dest: join(ctx.projectRoot, "docs/harness/gates/in-progress.md"),
    },
    {
      source: join(templatesRoot, "docs/harness/gates/pre-merge.md"),
      dest: join(ctx.projectRoot, "docs/harness/gates/pre-merge.md"),
    },
    {
      source: join(templatesRoot, "docs/harness/gates/post-merge.md"),
      dest: join(ctx.projectRoot, "docs/harness/gates/post-merge.md"),
    },
    {
      source: join(templatesRoot, "docs/harness/gates/next-ready.md"),
      dest: join(ctx.projectRoot, "docs/harness/gates/next-ready.md"),
    },
  ];

  const appends: AppendEntry[] = [
    {
      source: join(templatesRoot, "gitignore.template"),
      dest: join(ctx.projectRoot, ".gitignore"),
      marker: ".opencode/harness-loop.local.json",
    },
  ];

  const created: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const entry of copies) {
    try {
      if (existsSync(entry.dest)) {
        skipped.push(entry.dest);
        continue;
      }
      mkdirSync(dirname(entry.dest), { recursive: true });
      const content = readFileSync(entry.source, "utf-8");
      writeFileSync(entry.dest, content, "utf-8");
      if (entry.executable) {
        chmodSync(entry.dest, 0o755);
      }
      created.push(entry.dest);
    } catch (err) {
      failed.push(
        `${entry.dest}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  for (const entry of appends) {
    try {
      const sourceContent = readFileSync(entry.source, "utf-8");
      let needAppend = true;
      if (existsSync(entry.dest)) {
        const existing = readFileSync(entry.dest, "utf-8");
        if (existing.includes(entry.marker)) {
          needAppend = false;
          skipped.push(`${entry.dest} (marker already present)`);
        }
      }
      if (needAppend) {
        if (!existsSync(entry.dest)) {
          writeFileSync(entry.dest, "", "utf-8");
        }
        appendFileSync(entry.dest, sourceContent, "utf-8");
        created.push(`${entry.dest} (appended)`);
      }
    } catch (err) {
      failed.push(
        `${entry.dest}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (failed.length > 0) {
    ctx.showToast(
      `⚠️ Harness init completed with ${failed.length} error(s). See assistant message for details.`,
      "warning"
    );
  } else {
    ctx.showToast(
      `🚀 Harness initialized — ${created.length} file(s) created, ${skipped.length} skipped.`,
      "info"
    );
  }

  const reportLines = [
    "## /harness-init report",
    "",
    `**Project root:** \`${ctx.projectRoot}\``,
    "",
  ];

  if (created.length > 0) {
    reportLines.push("### Created");
    for (const p of created) reportLines.push(`- ${p}`);
    reportLines.push("");
  }
  if (skipped.length > 0) {
    reportLines.push("### Skipped (already exists)");
    for (const p of skipped) reportLines.push(`- ${p}`);
    reportLines.push("");
  }
  if (failed.length > 0) {
    reportLines.push("### Failed");
    for (const p of failed) reportLines.push(`- ${p}`);
    reportLines.push("");
  }

  reportLines.push("### What was set up");
  reportLines.push("- `.opencode/harness.config.json` — 5-gate skeleton (pre-work, in-progress, pre-merge, post-merge, next-ready)");
  reportLines.push("- `scripts/harness-check.sh` — **NO-OP STUB**: every gate returns PASS. Useful for verifying the wiring, but you almost certainly want to replace it.");
  reportLines.push("- `docs/harness/gates/*.md` — 5 placeholder gate docs");
  reportLines.push("- `.gitignore` — entries for runtime state files");
  reportLines.push("");
  reportLines.push("### Agent: please ask the user");
  reportLines.push("");
  reportLines.push(
    "The runner stub at `scripts/harness-check.sh` is currently a no-op (every gate returns PASS). The harness loop will technically run end-to-end, but it won't actually verify anything about your code. **Ask the user explicitly**:"
  );
  reportLines.push("");
  reportLines.push("1. **Do you want to customize `scripts/harness-check.sh` now?** (Recommended — otherwise the loop is just ceremony.)");
  reportLines.push("2. **If yes, what should each gate verify for this project?** Common per-stack patterns:");
  reportLines.push("   - **TypeScript/Node**: `pre-merge` runs `tsc --noEmit` + `vitest run` + lint + `npm pack --dry-run`");
  reportLines.push("   - **Python**: `pre-merge` runs `mypy` + `pytest` + `ruff` + `pip wheel`");
  reportLines.push("   - **Rust**: `pre-merge` runs `cargo build` + `cargo test` + `cargo clippy -- -D warnings`");
  reportLines.push("   - **Go**: `pre-merge` runs `go vet` + `go test ./...` + `golangci-lint run`");
  reportLines.push("   - Other gates (`pre-work`, `in-progress`, `post-merge`, `next-ready`) are usually lighter — pre-work checks branch state, post-merge checks main is clean.");
  reportLines.push("3. **Read each gate doc** at `docs/harness/gates/*.md` and fill in the project's actual hard rules + FAIL conditions. The agent should populate these based on the user's answers above.");
  reportLines.push("");
  reportLines.push("After customization:");
  reportLines.push("- Restart OpenCode (so the slash-command shims are scanned)");
  reportLines.push("- Run `/harness-on` to start the loop");
  reportLines.push("- Or run `/harness-check pre-merge` first to sanity-check your runner without starting a loop");

  await ctx.injectMessage(reportLines.join("\n"));
}
