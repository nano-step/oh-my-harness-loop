import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleHarnessInit } from "../commands/harness-init.js";
import { handleHarnessCheck } from "../commands/harness-check.js";

describe("E2E smoke: /harness-init", () => {
  it("copies template files into fresh project", async () => {
    const root = mkdtempSync(join(tmpdir(), "init-smoke-"));
    try {
      const showToast = vi.fn();
      const injectMessage = vi.fn().mockResolvedValue(undefined);
      await handleHarnessInit({ projectRoot: root, showToast, injectMessage });

      expect(existsSync(join(root, ".opencode/harness.config.json"))).toBe(true);
      expect(existsSync(join(root, "scripts/harness-check.sh"))).toBe(true);
      expect(existsSync(join(root, "docs/harness/gates/pre-work.md"))).toBe(true);
      expect(existsSync(join(root, "docs/harness/gates/in-progress.md"))).toBe(true);
      expect(existsSync(join(root, "docs/harness/gates/pre-merge.md"))).toBe(true);
      expect(existsSync(join(root, "docs/harness/gates/post-merge.md"))).toBe(true);
      expect(existsSync(join(root, "docs/harness/gates/next-ready.md"))).toBe(true);
      expect(existsSync(join(root, ".gitignore"))).toBe(true);
      expect(readFileSync(join(root, ".gitignore"), "utf-8")).toContain(
        ".opencode/harness-loop.local.json"
      );

      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("Harness initialized"),
        "info"
      );
      expect(injectMessage).toHaveBeenCalledOnce();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves existing files (idempotent)", async () => {
    const root = mkdtempSync(join(tmpdir(), "init-smoke-"));
    try {
      const showToast = vi.fn();
      const injectMessage = vi.fn().mockResolvedValue(undefined);
      await handleHarnessInit({ projectRoot: root, showToast, injectMessage });

      // Second run should not overwrite
      const customConfig = `{"custom":"do-not-overwrite"}`;
      writeFileSync(
        join(root, ".opencode/harness.config.json"),
        customConfig,
        "utf-8"
      );

      await handleHarnessInit({ projectRoot: root, showToast, injectMessage });

      const after = readFileSync(
        join(root, ".opencode/harness.config.json"),
        "utf-8"
      );
      expect(after).toBe(customConfig);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("E2E smoke: /harness-check", () => {
  it("errors out when no gate arg given", async () => {
    const root = mkdtempSync(join(tmpdir(), "check-smoke-"));
    try {
      const showToast = vi.fn();
      const injectMessage = vi.fn().mockResolvedValue(undefined);
      await handleHarnessCheck(
        { projectRoot: root, showToast, injectMessage },
        []
      );
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining("Usage:"),
        "error"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("errors out for unknown gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "check-smoke-"));
    try {
      const showToast = vi.fn();
      const injectMessage = vi.fn().mockResolvedValue(undefined);
      await handleHarnessInit({ projectRoot: root, showToast, injectMessage });
      // Reset mocks after init
      showToast.mockClear();
      injectMessage.mockClear();
      await handleHarnessCheck(
        { projectRoot: root, showToast, injectMessage },
        ["nonexistent-gate"]
      );
      const wasErrorToast = showToast.mock.calls.some(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("Unknown gate") &&
          call[1] === "error"
      );
      expect(wasErrorToast).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
