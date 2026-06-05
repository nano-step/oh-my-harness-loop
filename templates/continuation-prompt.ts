import { SYSTEM_DIRECTIVE_PREFIX } from "../constants.js";
import type { RunnerOutput, HarnessConfig } from "../types.js";
import type { GateInstructionsResult } from "../types.js";

export interface ContinuationPromptContext {
  gate: string;
  gateIteration: number;
  maxIterationsPerGate: number;
  totalIteration: number;
  maxTotalIterations: number;
  featureId: string | null;
  runnerOutput: RunnerOutput;
  config: HarnessConfig;
  gateInstructions: GateInstructionsResult;
  gatesPassed?: number;
  gatesTotal?: number;
}

function buildHeader(suffix: string): string {
  return `${SYSTEM_DIRECTIVE_PREFIX} - ${suffix}]`;
}

function buildStatusLine(ctx: ContinuationPromptContext): string {
  const passed = ctx.gatesPassed ?? 0;
  const total = ctx.gatesTotal ?? ctx.config.gates.length;
  const remaining = Math.max(total - passed, 0);
  return `[Status: ${passed}/${total} gates passed, ${remaining} remaining | gate "${ctx.gate}" iter=${ctx.gateIteration}/${ctx.maxIterationsPerGate} | total=${ctx.totalIteration}/${ctx.maxTotalIterations}]`;
}

function buildInstructionsSection(
  gateInstructions: GateInstructionsResult
): string {
  const lines: string[] = [];

  if (gateInstructions.docPath) {
    lines.push(`📖 Read project's gate protocol FIRST (mandatory):`);
    lines.push(`   ${gateInstructions.docPath}`);
    lines.push("");
  } else if (gateInstructions.warning) {
    lines.push(`⚠️ ${gateInstructions.warning}`);
    lines.push("");
  }

  if (gateInstructions.skills.length > 0) {
    lines.push(`🔧 Load skills before attempting fix:`);
    for (const skill of gateInstructions.skills) {
      lines.push(`   - ${skill}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildFailPrompt(ctx: ContinuationPromptContext): string {
  const ruleIds =
    ctx.runnerOutput.rule_ids_violated.length > 0
      ? ctx.runnerOutput.rule_ids_violated.join(", ")
      : "none specified";

  const instructionsSection = buildInstructionsSection(ctx.gateInstructions);
  const runnerInstructions =
    ctx.runnerOutput.instructions_for_agent ?? "No specific instructions provided.";

  const parts = [
    buildHeader("GATE CONTINUATION"),
    `Gate "${ctx.gate}" FAILED. Rules violated: ${ruleIds}. Fix the failures and continue working on the next pending task.`,
    "- Proceed without asking for permission",
    "- Address each rule violation by editing the relevant code/config",
    `- Do not stop until <promise>${ctx.config.completion_promise}</promise> is emitted AND all gates have passed`,
    "- If you believe all work is already complete, the system is questioning your completion claim. Critically re-examine the loop state file `.opencode/harness-loop.local.json` to verify which gates have actually passed before claiming complete.",
    "",
  ];

  if (instructionsSection) {
    parts.push(instructionsSection);
  }

  parts.push("Runner instructions:");
  parts.push(runnerInstructions);
  parts.push("");
  parts.push(
    `The harness will re-check "${ctx.gate}" automatically on your next idle.`
  );
  parts.push(
    'If you cannot fix and need human input, add "[HARNESS-OVERRIDE]: <reason>" to your reply and the loop will pause for user approval.'
  );

  if (ctx.featureId) {
    parts.push(`Original feature: ${ctx.featureId}`);
  }

  parts.push("");
  parts.push(buildStatusLine(ctx));

  return parts.join("\n");
}

export function buildBlockedPrompt(ctx: ContinuationPromptContext): string {
  const instructionsSection = buildInstructionsSection(ctx.gateInstructions);
  const runnerInstructions =
    ctx.runnerOutput.instructions_for_agent ??
    "No specific instructions provided. Human intervention needed.";

  const parts = [
    buildHeader("GATE BLOCKED — HUMAN INPUT NEEDED"),
    `Gate "${ctx.gate}" is BLOCKED. This gate cannot proceed without operator decision — stop autonomous work and wait for guidance.`,
    "- Do NOT continue past this gate until the operator responds",
    "- Surface the BLOCKED state clearly in your reply",
    "- Do NOT emit completion promise until operator unblocks",
    "",
  ];

  if (instructionsSection) {
    parts.push(instructionsSection);
  }

  parts.push("Runner instructions:");
  parts.push(runnerInstructions);
  parts.push("");
  parts.push("Operator options:");
  parts.push("1. Provide instructions on how to proceed");
  parts.push("2. Run `/harness-off` to cancel the loop");
  parts.push('3. Add `[HARNESS-OVERRIDE]: <reason>` to skip this gate');
  parts.push("");
  parts.push(buildStatusLine(ctx));

  return parts.join("\n");
}

export function buildWaitingPrompt(
  ctx: ContinuationPromptContext,
  waitSeconds: number
): string {
  return [
    buildHeader("GATE WAITING"),
    `Gate "${ctx.gate}" returned WAITING. The harness will re-check in ${waitSeconds}s.`,
    "- Do NOT take any action on this gate while waiting",
    "- The loop will retry automatically when the wait elapses",
    "- Do NOT emit completion promise during the wait window",
    "",
    buildStatusLine(ctx),
  ].join("\n");
}

export function buildPassTransitionPrompt(
  previousGate: string,
  nextGate: string
): string {
  return [
    buildHeader("GATE PASS — CONTINUE"),
    `Gate "${previousGate}" PASSED. Now working on the next pending gate "${nextGate}".`,
    "- Proceed without asking for permission",
    `- Read the gate doc for "${nextGate}" and begin its procedure`,
    "- Do not stop until all remaining gates pass",
  ].join("\n");
}

export function buildCompletionPrompt(
  source: "promise_tag" | "structural"
): string {
  const reason =
    source === "promise_tag"
      ? "Completion promise tag detected and structurally verified (all gates PASS, runner output PASS, at last gate, next_gate=null)."
      : "All gates passed and final gate reached (structural completion).";

  return [
    buildHeader("LOOP COMPLETE"),
    `🎉 Harness loop complete. ${reason}`,
    "- All work is done — no further action needed for this loop",
    "- The harness state file has been removed — run /harness-on to start the next cycle",
  ].join("\n");
}
