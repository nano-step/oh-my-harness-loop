import { z } from "zod";

// =============================================================================
// Runner Contract Types (from harness-runner-contract spec)
// =============================================================================

/**
 * Status values that a runner can return.
 */
export const RunnerStatusSchema = z.enum([
  "PASS",
  "FAIL",
  "SKIP",
  "WAITING",
  "BLOCKED",
  "ERROR",
]);
export type RunnerStatus = z.infer<typeof RunnerStatusSchema>;

/**
 * Individual check result within a gate.
 */
export const RunnerCheckSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["PASS", "FAIL", "SKIP"]),
  rule_id: z.string().optional(),
  message: z.string().optional(),
});
export type RunnerCheck = z.infer<typeof RunnerCheckSchema>;

/**
 * Output from the runner script.
 * Strict schema: rejects unknown fields.
 */
export const RunnerOutputSchema = z
  .object({
    gate: z.string(),
    status: RunnerStatusSchema,
    checks: z.array(RunnerCheckSchema).default([]),
    next_gate: z.string().nullable().optional(),
    instructions_for_agent: z.string().optional(),
    wait_seconds: z.number().optional(),
    rule_ids_violated: z.array(z.string()).default([]),
  })
  .strict();
export type RunnerOutput = z.infer<typeof RunnerOutputSchema>;

// =============================================================================
// Parallel Watcher Types
// =============================================================================

export interface ParallelWatcherEntry {
  task_id: string;
  status: "pending" | "done" | "cancelled";
  result: RunnerOutput | null;
  started_at: string;
}

export const ParallelWatcherEntrySchema = z.object({
  task_id: z.string(),
  status: z.enum(["pending", "done", "cancelled"]),
  result: RunnerOutputSchema.nullable(),
  started_at: z.string(),
});

// =============================================================================
// Epic Mode Types (from epic-mode spec)
// =============================================================================

/**
 * Status of a story within an epic backlog.
 */
export const StoryStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
  "skipped",
]);
export type StoryStatus = z.infer<typeof StoryStatusSchema>;

/**
 * A single story in the epic backlog.
 */
export const BacklogStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  feature_id: z.string().optional(),
  issue_number: z.number().optional(),
  story: z.string().optional(),
  depends_on: z.array(z.string()).default([]),
});
export type BacklogStory = z.infer<typeof BacklogStorySchema>;

/**
 * Full epic backlog (loaded from file or adapter).
 */
export const BacklogSchema = z.object({
  epic_id: z.string(),
  title: z.string().optional(),
  stories: z.array(BacklogStorySchema).min(1),
});
export type Backlog = z.infer<typeof BacklogSchema>;

/**
 * Progress entry for a single story in an epic.
 */
export const EpicProgressEntrySchema = z.object({
  story_id: z.string(),
  status: StoryStatusSchema,
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  gate_reached: z.string().optional(),
});
export type EpicProgressEntry = z.infer<typeof EpicProgressEntrySchema>;

/**
 * Epic-level state stored inside LoopMeta when epic mode is active.
 */
export const EpicMetaSchema = z.object({
  enabled: z.literal(true),
  epic_id: z.string(),
  current_story_id: z.string().nullable(),
  story_progress: z.array(EpicProgressEntrySchema).default([]),
  backlog_snapshot: BacklogSchema,
  failure_policy: z.enum(["ask"]),
  max_iterations_per_epic: z.number().default(500),
  epic_iteration_total: z.number().default(0),
});
export type EpicMeta = z.infer<typeof EpicMetaSchema>;

/**
 * Epic configuration in harness.config.json.
 */
export const EpicConfigSchema = z.object({
  backlog_source: z.enum(["file"]).default("file"),
  backlog_file: z.string().default(".opencode/harness.epic.json"),
  failure_policy: z.enum(["ask"]).default("ask"),
  max_iterations_per_epic: z.number().default(500),
});
export type EpicConfig = z.infer<typeof EpicConfigSchema>;

// =============================================================================
// Configuration Types (from harness-loop-config spec)
// =============================================================================

/**
 * Per-task entry inside a gate's parallel[] array.
 */
export const ParallelTaskSchema = z.object({
  id: z.string(),
  async: z.boolean().default(true),
  async_subagent_type: z.string().default("quick"),
  async_max_wait_seconds: z.number().default(300),
  async_poll_interval_seconds: z.number().default(60),
  doc: z.string().optional(),
  skills: z.array(z.string()).default([]),
});
export type ParallelTask = z.infer<typeof ParallelTaskSchema>;

/**
 * Per-gate instruction configuration.
 */
export const GateInstructionSchema = z.object({
  doc: z.string().optional(),
  skills: z.array(z.string()).default([]),
  async: z.boolean().default(false),
  async_max_wait_seconds: z.number().default(1800),
  async_poll_interval_seconds: z.number().default(60),
  async_subagent_type: z.string().default("quick"),
  force: z.boolean().default(false),
  parallel: z.array(ParallelTaskSchema).optional(),
});
export type GateInstruction = z.infer<typeof GateInstructionSchema>;

/**
 * Phase hooks for before/after gate execution.
 */
export const PhaseHookSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
});
export type PhaseHook = z.infer<typeof PhaseHookSchema>;

/**
 * Fail policy for handling gate failures.
 */
export const FailPolicySchema = z.enum(["auto", "hybrid", "ask"]);
export type FailPolicy = z.infer<typeof FailPolicySchema>;

/**
 * Main harness configuration schema.
 */
export const HarnessConfigSchema = z
  .object({
    runner_path: z.string(),
    gates: z.array(z.string()).min(1),
    fail_policy: FailPolicySchema.default("hybrid"),
    rule_id_format: z.string().default("{id}"),
    max_total_iterations: z.number().default(100),
    max_iterations_per_gate: z.number().default(10),
    auto_fix_attempts: z.number().default(3),
    cache_ttl_minutes: z.number().default(30),
    runner_timeout_seconds: z.number().default(300),
    completion_promise: z.string().default("HARNESS-COMPLETE"),
    ultrawork_verify_gates: z.array(z.string()).default([]),
    state_file_path: z.string().default(".opencode/harness-loop.local.json"),
    gate_instructions: z.record(z.string(), GateInstructionSchema).default({}),
    phase_hooks: z.record(z.string(), PhaseHookSchema).default({}),
    strict_instructions: z.boolean().default(false),
    async_heartbeats: z.boolean().default(true),
    epic: EpicConfigSchema.optional(),
  })
  .strict();
export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

/**
 * Snapshot of config stored in state for resume scenarios.
 */
export type ConfigSnapshot = HarnessConfig;

// =============================================================================
// State Types (from harness-loop-state spec)
// =============================================================================

/**
 * Checkpoint entry (capyhome-compat format).
 */
export interface CheckpointEntry {
  status: RunnerStatus;
  checked_at: string; // ISO 8601
  story?: string;
  issue_number?: number;
  checks?: Record<string, { status: string; message?: string }>;
}

/**
 * Loop metadata (plugin-private).
 */
export interface LoopMeta {
  active: boolean;
  current_gate: string;
  gate_iteration: number;
  total_iteration: number;
  max_iterations_per_gate: number;
  max_total_iterations: number;
  started_at: string; // ISO 8601
  session_id: string;
  config_snapshot: ConfigSnapshot;
  last_runner_output: RunnerOutput | null;
  no_progress_count: number;
  same_error_history: Record<string, string[][]>;
  verification_pending: boolean;
  parallel_watchers: Record<string, ParallelWatcherEntry>;
  message_count_at_start: number;
  epic?: EpicMeta;
}

/**
 * Full harness loop state file schema.
 */
export interface HarnessLoopState {
  feature_id: string | null;
  issue_number: number | null;
  story: string | null;
  updated_at: string; // ISO 8601
  checkpoints: Record<string, CheckpointEntry>;
  loop: LoopMeta;
}

/**
 * Zod schema for state validation on read/write.
 */
export const LoopMetaSchema = z.object({
  active: z.boolean(),
  current_gate: z.string(),
  gate_iteration: z.number(),
  total_iteration: z.number(),
  max_iterations_per_gate: z.number(),
  max_total_iterations: z.number(),
  started_at: z.string(),
  session_id: z.string(),
  config_snapshot: HarnessConfigSchema,
  last_runner_output: RunnerOutputSchema.nullable(),
  no_progress_count: z.number(),
  same_error_history: z.record(z.string(), z.array(z.array(z.string()))),
  verification_pending: z.boolean(),
  parallel_watchers: z.record(z.string(), ParallelWatcherEntrySchema),
  message_count_at_start: z.number(),
  epic: EpicMetaSchema.optional(),
});

export const CheckpointEntrySchema = z.object({
  status: RunnerStatusSchema,
  checked_at: z.string(),
  story: z.string().optional(),
  issue_number: z.number().optional(),
  checks: z
    .record(
      z.string(),
      z.object({
        status: z.string(),
        message: z.string().optional(),
      })
    )
    .optional(),
});

export const HarnessLoopStateSchema = z.object({
  feature_id: z.string().nullable(),
  issue_number: z.number().nullable(),
  story: z.string().nullable(),
  updated_at: z.string(),
  checkpoints: z.record(z.string(), CheckpointEntrySchema),
  loop: LoopMetaSchema,
});

// =============================================================================
// CLI Override Types
// =============================================================================

/**
 * CLI argument overrides for /harness-on command.
 */
export interface ConfigOverrides {
  force?: boolean;
  maxIter?: number;
  skipGate?: string[];
  configPath?: string;
  startFromGate?: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error thrown when harness config is invalid.
 */
export class HarnessConfigError extends Error {
  constructor(
    message: string,
    public readonly details?: z.ZodError
  ) {
    super(message);
    this.name = "HarnessConfigError";
  }
}

/**
 * Error thrown when state file is corrupted.
 */
export class StateCorruptionError extends Error {
  constructor(
    message: string,
    public readonly filePath: string
  ) {
    super(message);
    this.name = "StateCorruptionError";
  }
}

/**
 * Error thrown when runner contract is violated.
 */
export class RunnerContractError extends Error {
  constructor(
    message: string,
    public readonly details?: z.ZodError
  ) {
    super(message);
    this.name = "RunnerContractError";
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result of gate instructions resolution.
 */
export interface GateInstructionsResult {
  docPath: string | null;
  skills: string[];
  warning: string | null;
  isAsync: boolean;
  asyncConfig: {
    maxWaitSeconds: number;
    pollIntervalSeconds: number;
    subagentType: string;
  } | null;
}

/**
 * Completion detection result.
 */
export type CompletionSource = "promise_tag" | "structural" | null;

/**
 * Config load result.
 */
export interface ConfigLoadResult {
  config: HarnessConfig;
  overrideConsumed: boolean;
}
