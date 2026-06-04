export interface HarnessTeamContext {
  projectRoot: string;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
  injectMessage(text: string): Promise<void>;
}

interface HarnessTeamOptions {
  audit: boolean;
}

function parseArgs(args: string[]): HarnessTeamOptions {
  return {
    audit: args.includes("--audit"),
  };
}

function buildFactoryPrompt(projectRoot: string): string {
  return [
    "## /harness-team",
    "",
    `**Project root:** \`${projectRoot}\``,
    "",
    "Load the `team-architecture-factory` skill and execute its full 7-phase workflow.",
    "",
    "Start with **Phase 0 (Audit)**: read `.opencode/agents/`, `.opencode/skills/`, and `AGENTS.md` to detect any existing harness. Branch on findings:",
    "- New build: execute Phases 1-7",
    "- Extend existing: use the Phase Selection Matrix from the skill",
    "- Maintenance: jump to Phase 7-5 maintenance workflow",
    "",
    "The user's domain description should come from the preceding chat messages. If no domain is described, ask the user to describe their domain before proceeding.",
    "",
    "Reference docs at `skills/team-architecture-factory/references/*.md` (loaded on demand).",
    "",
    "⚠️ This is the team-architecture factory. It is NOT the harness gate-loop (`/harness-on`). Do not touch `.opencode/harness-loop.local.json` or `.opencode/harness.config.json`.",
  ].join("\n");
}

function buildAuditPrompt(projectRoot: string): string {
  return [
    "## /harness-team --audit",
    "",
    `**Project root:** \`${projectRoot}\``,
    "",
    "Load the `team-architecture-factory` skill and run **Phase 0 (Audit) only**.",
    "",
    "Produce a status report:",
    "- Agent files found in `.opencode/agents/` (count + names)",
    "- Skill directories found in `.opencode/skills/` (count + names)",
    "- AGENTS.md harness pointer sections (count + domain names)",
    "- Conflicts or duplicates detected",
    "",
    "Do NOT generate or modify any files. Report only.",
  ].join("\n");
}

export async function handleHarnessTeam(
  ctx: HarnessTeamContext,
  args: string[]
): Promise<void> {
  const opts = parseArgs(args);

  if (opts.audit) {
    ctx.showToast("🔍 Auditing existing agent team...", "info");
    await ctx.injectMessage(buildAuditPrompt(ctx.projectRoot));
    return;
  }

  ctx.showToast("🏗️ Starting team architecture factory...", "info");
  await ctx.injectMessage(buildFactoryPrompt(ctx.projectRoot));
}
