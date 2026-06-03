import { SYSTEM_DIRECTIVE_PREFIX } from "../constants.js";
import type { HarnessLoopState } from "../types.js";

export function buildEpicCompletionPrompt(state: HarnessLoopState): string {
  const epic = state.loop.epic;
  if (!epic) return "";

  const completedEntries = epic.story_progress.filter(
    (e) => e.status === "completed"
  );
  const total = epic.backlog_snapshot.stories.length;
  const completedIds = completedEntries.map((e) => e.story_id).join(", ");
  const promise = state.loop.config_snapshot.completion_promise;

  return [
    `${SYSTEM_DIRECTIVE_PREFIX} — EPIC COMPLETE]`,
    "",
    `Epic "${epic.epic_id}" complete. ${completedEntries.length}/${total} stories done.`,
    `Completed: ${completedIds}`,
    "",
    `Emit \`<promise>${promise}</promise>\` to signal completion.`,
  ].join("\n");
}

export function buildEpicPausePrompt(
  storyId: string,
  gate: string,
  reason: string
): string {
  return [
    `${SYSTEM_DIRECTIVE_PREFIX} — EPIC PAUSED]`,
    "",
    `Epic paused: ${reason}`,
    `Story "${storyId}" stopped at gate "${gate}".`,
    "",
    "Fix the issue, then run `/harness-on --epic --resume` to continue.",
  ].join("\n");
}
