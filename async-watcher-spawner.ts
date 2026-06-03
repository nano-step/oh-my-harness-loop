import type { HarnessConfig, HarnessLoopState, RunnerOutput } from "./types.js";
import { RunnerOutputSchema } from "./types.js";

export interface WatcherSpawnContext {
  spawnBackgroundTask(
    subagentType: string,
    prompt: string
  ): Promise<string>;
}

export function buildWatcherPrompt(
  gate: string,
  config: HarnessConfig,
  state: HarnessLoopState,
  taskId?: string
): string {
  const gateConfig = config.gate_instructions[gate];
  const maxWait = gateConfig?.async_max_wait_seconds ?? 1800;
  const pollInterval = gateConfig?.async_poll_interval_seconds ?? 60;
  const runnerPath = config.runner_path;
  const featureId = state.feature_id ?? "";
  const taskFlag = taskId ? ` --task ${taskId}` : "";

  return `You are a harness loop background watcher for gate "${gate}".

TASK: Poll the runner until it returns a terminal status (PASS, FAIL, BLOCKED) or timeout.

RUNNER COMMAND:
${runnerPath} ${gate}${taskFlag} --json${featureId ? ` --feature=${featureId}` : ""}

POLL LOOP:
1. Run the runner command, capture stdout.
2. Parse JSON. Extract \`status\` field.
3. If status in [PASS, FAIL, BLOCKED] → output the JSON verbatim as your final response and stop.
4. If status == WAITING → sleep ${pollInterval} seconds.
5. If total elapsed > ${maxWait} seconds → output a synthesized JSON:
   {"gate": "${gate}", "status": "FAIL", "instructions_for_agent": "Watcher timed out after ${maxWait}s; gate did not reach terminal status", "rule_ids_violated": ["watcher-timeout"]}
   and stop.
6. Otherwise repeat from step 1.

OUTPUT FORMAT: Exactly one JSON object matching the RunnerOutput contract. Nothing else. No prose, no explanations.

CONSTRAINTS:
- Do NOT modify any files.
- Do NOT spawn other subagents.
- Do NOT use any tool other than bash.
- Total wall-clock time MUST be bounded by ${maxWait} seconds.`;
}

export async function spawnWatcher(
  ctx: WatcherSpawnContext,
  gate: string,
  config: HarnessConfig,
  state: HarnessLoopState,
  taskId?: string
): Promise<string> {
  const gateConfig = config.gate_instructions[gate];
  const subagentType = gateConfig?.async_subagent_type ?? "quick";
  const prompt = buildWatcherPrompt(gate, config, state, taskId);

  return ctx.spawnBackgroundTask(subagentType, prompt);
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        depth = 0;
        start = -1;
      }
    }
  }
  return candidates;
}

export function parseWatcherResult(
  result: string,
  gate: string
): RunnerOutput {
  const trimmed = result.trim();
  const candidates = extractJsonCandidates(trimmed);

  if (candidates.length === 0) {
    return {
      gate,
      status: "ERROR",
      checks: [],
      rule_ids_violated: ["watcher-parse-error"],
      instructions_for_agent: "Watcher did not return valid JSON",
    };
  }

  let lastSchemaError: string | null = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidates[i]!);
    } catch {
      continue;
    }
    const validated = RunnerOutputSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
    lastSchemaError = validated.error.message;
  }

  if (lastSchemaError !== null) {
    return {
      gate,
      status: "ERROR",
      checks: [],
      rule_ids_violated: ["watcher-schema-error"],
      instructions_for_agent: `Watcher returned invalid schema: ${lastSchemaError}`,
    };
  }

  return {
    gate,
    status: "ERROR",
    checks: [],
    rule_ids_violated: ["watcher-parse-error"],
    instructions_for_agent: "Watcher returned non-JSON output",
  };
}


