import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILL_DIR = join(process.cwd(), "skills/team-architecture-factory");

describe("team-architecture-factory skill bundle", () => {
  it("SKILL.md exists and has valid frontmatter", () => {
    const path = join(SKILL_DIR, "SKILL.md");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("name: team-architecture-factory");
    expect(match![1]).toContain("description:");
  });

  it("SKILL.md body is <= 500 lines", () => {
    const content = readFileSync(join(SKILL_DIR, "SKILL.md"), "utf-8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it("all 6 reference docs exist", () => {
    const expected = [
      "agent-design-patterns.md",
      "orchestrator-template.md",
      "skill-writing-guide.md",
      "skill-testing-guide.md",
      "team-examples.md",
      "qa-agent-guide.md",
    ];
    for (const name of expected) {
      expect(existsSync(join(SKILL_DIR, "references", name))).toBe(true);
    }
  });

  it("LICENSE-UPSTREAM + NOTICE shipped", () => {
    expect(existsSync(join(SKILL_DIR, "assets/LICENSE-UPSTREAM"))).toBe(true);
    expect(existsSync(join(SKILL_DIR, "assets/NOTICE"))).toBe(true);
  });

  it("no Claude Code primitives leak into skill files", () => {
    const forbidden = [
      "TeamCreate",
      "SendMessage",
      "TaskCreate",
      "TaskUpdate",
      "TeamDelete",
      ".claude/",
      'model: "opus"',
    ];
    const files = [
      join(SKILL_DIR, "SKILL.md"),
      ...["agent-design-patterns", "orchestrator-template", "skill-writing-guide", "skill-testing-guide", "team-examples", "qa-agent-guide"].map(
        (n) => join(SKILL_DIR, "references", `${n}.md`)
      ),
    ];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const pattern of forbidden) {
        // Allow citations in translation-notes tables (e.g., "| TeamCreate | task() |")
        // by requiring the pattern be in normal prose, not inside a markdown table cell
        const lines = content.split("\n");
        const offending = lines.filter(
          (l) => l.includes(pattern) && !l.trim().startsWith("|")
        );
        expect(offending, `${file} contains forbidden pattern outside translation table: ${pattern}`).toHaveLength(0);
      }
    }
  });
});
