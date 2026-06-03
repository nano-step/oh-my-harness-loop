import { OVERRIDE_TOKEN_REGEX } from "./constants.js";
import type {
  HarnessConfig,
  HarnessLoopState,
  CompletionSource,
  RunnerOutput,
} from "./types.js";

export interface SessionContext {
  getMessages(): Array<{ role: string; content: string }>;
}

export interface PromiseTagResult {
  tagPresent: boolean;
  structuralPass: boolean;
  reason: string | null;
}

export interface CompletionResult {
  source: CompletionSource;
  liedAboutCompletion: boolean;
  lieReason: string | null;
}

function hasPromiseTag(
  messages: Array<{ role: string; content: string }>,
  completionPromise: string,
  messageCountAtStart: number
): boolean {
  const promisePattern = `<promise>${completionPromise}</promise>`;
  const recentMessages = messages.slice(messageCountAtStart);
  for (const msg of recentMessages) {
    if (msg.role === "assistant" && msg.content.includes(promisePattern)) {
      return true;
    }
  }
  return false;
}

function structuralGuard(
  state: HarnessLoopState,
  runnerOutput: RunnerOutput | null,
  config: HarnessConfig
): { pass: boolean; reason: string | null } {
  const gates = config.gates;
  if (gates.length === 0) {
    return { pass: false, reason: "config.gates is empty" };
  }
  const lastGate = gates[gates.length - 1]!;
  const currentGate = state.loop.current_gate;

  if (currentGate !== lastGate) {
    return {
      pass: false,
      reason: `current_gate="${currentGate}" but expected last gate "${lastGate}"`,
    };
  }

  const passedGates: string[] = [];
  const missingGates: string[] = [];
  for (const gate of gates) {
    const entry = state.checkpoints[gate];
    if (entry && entry.status === "PASS") {
      passedGates.push(gate);
    } else {
      missingGates.push(gate);
    }
  }
  if (missingGates.length > 0) {
    return {
      pass: false,
      reason: `gates not yet PASS: [${missingGates.join(", ")}] (passed: [${passedGates.join(", ")}])`,
    };
  }

  if (runnerOutput === null) {
    return { pass: false, reason: "no runner output recorded yet" };
  }
  if (runnerOutput.gate !== currentGate) {
    return {
      pass: false,
      reason: `stale runner output: runnerOutput.gate="${runnerOutput.gate}" does not match current_gate="${currentGate}"`,
    };
  }
  if (runnerOutput.status !== "PASS") {
    return {
      pass: false,
      reason: `runner status is "${runnerOutput.status}", not PASS`,
    };
  }
  if (
    runnerOutput.next_gate !== null &&
    runnerOutput.next_gate !== undefined
  ) {
    return {
      pass: false,
      reason: `runner returned next_gate="${runnerOutput.next_gate}", expected null`,
    };
  }

  return { pass: true, reason: null };
}

export function detectPromiseTag(
  messages: Array<{ role: string; content: string }>,
  completionPromise: string,
  state: HarnessLoopState,
  runnerOutput: RunnerOutput | null,
  config: HarnessConfig
): PromiseTagResult {
  const tagPresent = hasPromiseTag(
    messages,
    completionPromise,
    state.loop.message_count_at_start
  );
  if (!tagPresent) {
    return { tagPresent: false, structuralPass: false, reason: null };
  }
  const guard = structuralGuard(state, runnerOutput, config);
  return {
    tagPresent: true,
    structuralPass: guard.pass,
    reason: guard.reason,
  };
}

export function detectStructuralCompletion(
  state: HarnessLoopState,
  runnerOutput: RunnerOutput | null,
  config: HarnessConfig
): boolean {
  return structuralGuard(state, runnerOutput, config).pass;
}

export function detectCompletion(
  messages: Array<{ role: string; content: string }>,
  state: HarnessLoopState,
  runnerOutput: RunnerOutput | null,
  config: HarnessConfig
): CompletionResult {
  const tag = detectPromiseTag(
    messages,
    config.completion_promise,
    state,
    runnerOutput,
    config
  );

  if (tag.tagPresent && tag.structuralPass) {
    return {
      source: "promise_tag",
      liedAboutCompletion: false,
      lieReason: null,
    };
  }

  if (detectStructuralCompletion(state, runnerOutput, config)) {
    return {
      source: "structural",
      liedAboutCompletion: false,
      lieReason: null,
    };
  }

  if (tag.tagPresent && !tag.structuralPass) {
    return {
      source: null,
      liedAboutCompletion: true,
      lieReason: tag.reason,
    };
  }

  return { source: null, liedAboutCompletion: false, lieReason: null };
}

export function detectOverrideToken(
  messages: Array<{ role: string; content: string }>
): { found: boolean; reason: string | null } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      const match = OVERRIDE_TOKEN_REGEX.exec(msg.content);
      if (match) {
        return { found: true, reason: match[1] ?? null };
      }
      break;
    }
  }

  return { found: false, reason: null };
}
