# Harness Friction Backlog — oh-my-harness-loop

Track recurring friction points. Review after each retro.

| # | Friction | Observed | Proposed fix | Status |
|---|---------|---------|-------------|--------|
| 1 | Single `watcher_task_id` blocks parallel async gates | 2026-06-03 | `parallel_watchers` map (see openspec/changes/parallel-gate-execution) | In progress |
| 2 | Runner script must be user-provided, no default template | 2026-06-03 | Ship example runner scripts in docs/ | Backlog |
| 3 | No way to skip a specific task within a parallel gate | 2026-06-03 | `--skip-task` flag | Backlog |

---

## Adding Friction

When you hit a recurring pain point:

```
| N | <what was painful> | <date> | <proposed fix or "investigate"> | Backlog |
```

Backlog items are reviewed every 3 sprints or when a retro gate fires.
