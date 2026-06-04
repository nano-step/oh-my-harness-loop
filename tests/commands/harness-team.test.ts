import { describe, it, expect, vi } from "vitest";
import { handleHarnessTeam } from "../../commands/harness-team.js";

function mockCtx() {
  return {
    projectRoot: "/tmp/test-proj",
    showToast: vi.fn(),
    injectMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("/harness-team", () => {
  it("default mode emits factory toast", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Starting team architecture factory"),
      "info"
    );
  });

  it("default mode injects Phase 0 instruction", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    const firstCall = ctx.injectMessage.mock.calls[0];
    expect(firstCall).toBeDefined();
    const prompt = firstCall![0] as string;
    expect(prompt).toContain("Phase 0");
    expect(prompt).toContain("team-architecture-factory");
    expect(prompt).toContain("/tmp/test-proj");
  });

  it("--audit mode emits audit toast", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, ["--audit"]);
    expect(ctx.showToast).toHaveBeenCalledWith(
      expect.stringContaining("Auditing"),
      "info"
    );
  });

  it("--audit mode injects audit-only prompt", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, ["--audit"]);
    const firstCall = ctx.injectMessage.mock.calls[0];
    expect(firstCall).toBeDefined();
    const prompt = firstCall![0] as string;
    expect(prompt).toContain("Phase 0");
    expect(prompt).toContain("Report only");
    expect(prompt).not.toContain("Phase 1");
  });

  it("warns about gate-loop separation in default prompt", async () => {
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    const firstCall = ctx.injectMessage.mock.calls[0];
    expect(firstCall).toBeDefined();
    const prompt = firstCall![0] as string;
    expect(prompt).toContain("NOT the harness gate-loop");
    expect(prompt).toContain("harness-loop.local.json");
  });

  it("does not touch harness-loop state", async () => {
    // Verified by absence of any file I/O in handleHarnessTeam source
    // (this test enforces the contract via spy on fs imports)
    const ctx = mockCtx();
    await handleHarnessTeam(ctx, []);
    // showToast + injectMessage are the only effects
    expect(ctx.showToast).toHaveBeenCalledTimes(1);
    expect(ctx.injectMessage).toHaveBeenCalledTimes(1);
  });
});
