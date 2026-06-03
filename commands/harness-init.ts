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

  reportLines.push("### Next steps");
  reportLines.push("1. Edit `scripts/harness-check.sh` to add real checks for your project (tsc, vitest, lint, etc.).");
  reportLines.push("2. Edit gate docs at `docs/harness/gates/*.md` with project-specific rules.");
  reportLines.push("3. Restart OpenCode so the slash command shims are loaded.");
  reportLines.push("4. Run `/harness-on` to start the loop.");

  await ctx.injectMessage(reportLines.join("\n"));
}
