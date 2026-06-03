import { describe, it, expect } from "vitest";
import { parseWatcherResult } from "../async-watcher-spawner.js";

describe("parseWatcherResult — BUG H3: extract LAST valid JSON (not first greedy match)", () => {
  it("parses clean JSON output without surrounding noise", () => {
    const json = JSON.stringify({
      gate: "pre-work",
      status: "PASS",
      checks: [],
      rule_ids_violated: [],
      next_gate: "in-progress",
    });

    const result = parseWatcherResult(json, "pre-work");

    expect(result.status).toBe("PASS");
    expect(result.next_gate).toBe("in-progress");
  });

  it("parses LAST JSON object when output contains log text before it (H3 reproduction)", () => {
    const noisyOutput = `
Subagent log: Found issue {gh response} during analysis...
Trying to fetch context {ref: "abc"} → not relevant.

${JSON.stringify({
  gate: "pre-merge",
  status: "PASS",
  checks: [],
  rule_ids_violated: [],
  next_gate: null,
})}
`;

    const result = parseWatcherResult(noisyOutput, "pre-merge");

    expect(result.status).toBe("PASS");
    expect(result.next_gate).toBeNull();
  });

  it("skips earlier non-schema JSON candidates and picks the schema-valid one", () => {
    const output = `
{"not": "a runner output"}
{"also": "not", "valid": true}
${JSON.stringify({
  gate: "next-ready",
  status: "PASS",
  checks: [],
  rule_ids_violated: [],
  next_gate: null,
})}
`;

    const result = parseWatcherResult(output, "next-ready");

    expect(result.status).toBe("PASS");
    expect(result.gate).toBe("next-ready");
  });

  it("returns ERROR with parse-error rule when no JSON present", () => {
    const result = parseWatcherResult("just plain text\nno json here", "pre-work");

    expect(result.status).toBe("ERROR");
    expect(result.rule_ids_violated).toContain("watcher-parse-error");
  });

  it("returns ERROR with schema-error rule when JSON present but never matches schema", () => {
    const result = parseWatcherResult(
      JSON.stringify({ wrong: "shape", no: "gate field" }),
      "pre-work"
    );

    expect(result.status).toBe("ERROR");
    expect(result.rule_ids_violated).toContain("watcher-schema-error");
  });

  it("handles nested objects without breaking depth tracking", () => {
    const json = JSON.stringify({
      gate: "in-progress",
      status: "FAIL",
      checks: [{ id: "1", name: "type", status: "FAIL", details: { line: 42, msg: "err" } }],
      rule_ids_violated: ["R2.1"],
    });

    const result = parseWatcherResult(`prelude\n${json}\nepilogue`, "in-progress");

    expect(result.status).toBe("FAIL");
    expect(result.checks).toHaveLength(1);
  });
});
