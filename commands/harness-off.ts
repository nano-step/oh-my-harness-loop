import { createLoopStateController } from "../loop-state-controller.js";
import { readState, getStatePath } from "../storage.js";

export interface HarnessOffContext {
  projectRoot: string;
  showToast(message: string, variant: "info" | "warning" | "error"): void;
  cancelBackgroundTask?(taskId: string): Promise<void>;
}

export async function handleHarnessOff(ctx: HarnessOffContext): Promise<void> {
  const statePath = getStatePath(ctx.projectRoot);
  const state = readState(statePath);

  if (!state || !state.loop.active) {
    ctx.showToast("ℹ️ No active harness loop to cancel", "info");
    return;
  }

  if (ctx.cancelBackgroundTask) {
    for (const entry of Object.values(state.loop.parallel_watchers)) {
      if (entry.status !== "pending") continue;
      try {
        await ctx.cancelBackgroundTask(entry.task_id);
      } catch {
        // best-effort cancellation
      }
    }
    if (Object.values(state.loop.parallel_watchers).some((e) => e.status === "pending")) {
      ctx.showToast("\uD83D\uDED1 Cancelled active watcher subagent(s)", "info");
    }
  }

  const controller = createLoopStateController(ctx.projectRoot);
  controller.cancelLoop();

  ctx.showToast(
    `🛑 Harness loop cancelled at gate "${state.loop.current_gate}" (iteration ${state.loop.gate_iteration})`,
    "info"
  );
}
