import { SYSTEM_DIRECTIVE_PREFIX } from "../constants.js";
import type { HarnessLoopState } from "../types.js";

export function buildEpicStoryPrompt(
  storyId: string,
  state: HarnessLoopState
): string {
  const epic = state.loop.epic;
  if (!epic) return "";

  const story = epic.backlog_snapshot.stories.find((s) => s.id === storyId);
  if (!story) return "";

  const completed = epic.story_progress.filter(
    (e) => e.status === "completed"
  ).length;
  const total = epic.backlog_snapshot.stories.length;

  const storyBody = story.story
    ? story.story.length > 2000
      ? story.story.slice(0, 2000) + "..."
      : story.story
    : null;

  const parts = [
    `${SYSTEM_DIRECTIVE_PREFIX} — EPIC STORY]`,
    "",
    `Epic: ${epic.epic_id}${epic.backlog_snapshot.title ? ` — ${epic.backlog_snapshot.title}` : ""}`,
    `Progress: ${completed}/${total} stories completed`,
    "",
    `--- Story: ${story.id} ---`,
    `Title: ${story.title}`,
  ];

  if (story.feature_id) parts.push(`Feature: ${story.feature_id}`);
  if (story.issue_number) parts.push(`Issue: #${story.issue_number}`);

  if (storyBody) {
    parts.push("", storyBody);
  }

  parts.push(
    "",
    "Start the gate cycle for this story now. The harness will drive you through each gate automatically."
  );

  return parts.join("\n");
}
