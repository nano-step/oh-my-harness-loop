import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../config-loader.js";
import { invokeRunner } from "../runner-invoker.js";

export interface HarnessCheckContext {
  projectRoot: string;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
  injectMessage(text: string): Promise<void>;
}

export async function handleHarnessCheck(
  ctx: HarnessCheckContext,
  args: string[]
): Promise<void> {
  const gate = args[0]?.trim();
  if (!gate) {
    ctx.showToast(
      "❌ Usage: /harness-check <gate-name>",
      "error"
    );
    return;
  }

  let configResult;
  try {
    configResult = loadConfig(ctx.projectRoot);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.showToast(`❌ ${message}`, "error");
    return;
  }

  const { config } = configResult;

  if (!config.gates.includes(gate)) {
    ctx.showToast(
      `❌ Unknown gate "${gate}". Configured gates: ${config.gates.join(", ")}`,
      "error"
    );
    return;
  }

  const runnerPath = join(ctx.projectRoot, config.runner_path);
  if (!existsSync(runnerPath)) {
    ctx.showToast(`❌ Runner not found: ${config.runner_path}`, "error");
    return;
  }
  try {
    accessSync(runnerPath, constants.X_OK);
  } catch {
    ctx.showToast(
      `❌ Runner not executable: ${config.runner_path}`,
      "error"
    );
    return;
  }

  ctx.showToast(`🏃 Running gate "${gate}"...`, "info");

  const output = await invokeRunner(config, gate, ctx.projectRoot);

  const statusEmoji = {
    PASS: "✅",
    FAIL: "❌",
    SKIP: "⏭️",
    WAITING: "⏳",
    BLOCKED: "⏸️",
    ERROR: "💥",
  }[output.status] ?? "❓";

  ctx.showToast(
    `${statusEmoji} Gate "${gate}" → ${output.status}`,
    output.status === "PASS" || output.status === "SKIP"
      ? "info"
      : output.status === "FAIL" || output.status === "ERROR"
      ? "error"
      : "warning"
  );

  const reportLines = [
    `## /harness-check ${gate}`,
    "",
    `**Status:** ${statusEmoji} ${output.status}`,
  ];
  if (output.next_gate !== null && output.next_gate !== undefined) {
    reportLines.push(`**Next gate:** \`${output.next_gate}\``);
  }
  if (output.rule_ids_violated.length > 0) {
    reportLines.push(
      `**Rules violated:** ${output.rule_ids_violated.join(", ")}`
    );
  }
  if (output.checks.length > 0) {
    reportLines.push("", "### Checks");
    for (const c of output.checks) {
      const checkStatus = (c as { status?: string }).status ?? "?";
      const checkName = (c as { name?: string }).name ?? "?";
      const checkId = (c as { id?: string }).id ?? "?";
      reportLines.push(`- \`${checkId}\` ${checkName}: ${checkStatus}`);
    }
  }
  if (output.instructions_for_agent) {
    reportLines.push("", "### Instructions");
    reportLines.push(output.instructions_for_agent);
  }
  reportLines.push("");
  reportLines.push("_This was a manual `/harness-check` invocation. Loop state was NOT modified._");

  await ctx.injectMessage(reportLines.join("\n"));
}
