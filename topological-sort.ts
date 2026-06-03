import { HarnessConfigError, type BacklogStory } from "./types.js";

export function topologicalSort(stories: BacklogStory[]): BacklogStory[] {
  const storyMap = new Map<string, BacklogStory>();
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const s of stories) {
    storyMap.set(s.id, s);
    graph.set(s.id, new Set());
    inDegree.set(s.id, 0);
  }

  for (const s of stories) {
    for (const dep of s.depends_on) {
      if (!storyMap.has(dep)) {
        throw new HarnessConfigError(
          `Story "${s.id}" depends on "${dep}" which does not exist in the backlog`
        );
      }
      graph.get(dep)!.add(s.id);
      inDegree.set(s.id, (inDegree.get(s.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: BacklogStory[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(storyMap.get(id)!);
    for (const neighbor of graph.get(id) ?? []) {
      const nd = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, nd);
      if (nd === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== stories.length) {
    const remaining = stories
      .filter((s) => !sorted.find((x) => x.id === s.id))
      .map((s) => s.id);
    throw new HarnessConfigError(
      `Dependency cycle detected among stories: ${remaining.join(", ")}`
    );
  }

  return sorted;
}
