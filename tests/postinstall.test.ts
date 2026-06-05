import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, dirname } from "node:path";

const testDirs: string[] = [];

afterEach(() => {
  for (const dir of testDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  testDirs.length = 0;
});

function runPostinstall(env: Record<string, string | undefined>) {
  const scriptPath = join(__dirname, "..", "scripts", "postinstall.js");
  const fullEnv: Record<string, string> = {
    PATH: process.env["PATH"] || "",
    ...env,
  };
  return spawnSync("node", [scriptPath], {
    env: fullEnv,
    encoding: "utf-8",
  });
}

describe("postinstall.js", () => {
  it("exits 0 when OH_MY_HARNESS_SKIP_POSTINSTALL=1", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: "1",
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(tmpDir, ".opencode", "commands", "harness-on.md")))
      .toBe(false);
  });

  it("exits 0 when INIT_CWD is not set (treated as dev/manual run)", () => {
    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: undefined,
    });

    expect(result.status).toBe(0);
  });

  it("exits 0 when INIT_CWD points to package root (dev-install detection)", () => {
    const packageRoot = join(__dirname, "..");
    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: packageRoot,
    });

    expect(result.status).toBe(0);
  });

  it("creates all 4 shim files on fresh install", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);

    const harness_on_path = join(tmpDir, ".opencode", "commands", "harness-on.md");
    const harness_off_path = join(tmpDir, ".opencode", "commands", "harness-off.md");
    const harness_init_path = join(tmpDir, ".opencode", "commands", "harness-init.md");
    const harness_check_path = join(tmpDir, ".opencode", "commands", "harness-check.md");

    expect(existsSync(harness_on_path)).toBe(true);
    expect(existsSync(harness_off_path)).toBe(true);
    expect(existsSync(harness_init_path)).toBe(true);
    expect(existsSync(harness_check_path)).toBe(true);

    const harness_on_content = readFileSync(harness_on_path, "utf-8");
    const harness_off_content = readFileSync(harness_off_path, "utf-8");
    const harness_init_content = readFileSync(harness_init_path, "utf-8");
    const harness_check_content = readFileSync(harness_check_path, "utf-8");

    expect(harness_on_content).toContain(
      "description: Start the harness gate loop for the current feature"
    );
    expect(harness_on_content).toContain("$ARGUMENTS");
    expect(harness_init_content).toContain(
      "description: Bootstrap harness setup in the current project (interactive)"
    );
    expect(harness_check_content).toContain(
      "description: Manually run a single gate via the configured runner (read-only)"
    );
    expect(harness_check_content).toContain("$ARGUMENTS");

    expect(harness_off_content).toContain(
      "description: Cancel the active harness gate loop"
    );
  });

  it("does not overwrite existing shim files (idempotent)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    mkdirSync(join(tmpDir, ".opencode", "commands"), { recursive: true });

    const harness_on_path = join(tmpDir, ".opencode", "commands", "harness-on.md");
    const customContent = "---\ndescription: CUSTOM\n---\n";
    writeFileSync(harness_on_path, customContent, "utf-8");

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);

    const harness_off_path = join(
      tmpDir,
      ".opencode",
      "commands",
      "harness-off.md"
    );
    expect(existsSync(harness_off_path)).toBe(true);

    const harness_on_updated = readFileSync(harness_on_path, "utf-8");
    expect(harness_on_updated).toBe(customContent);
  });

  it("exits 0 even if directory creation fails (fail-safe)", () => {
    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: "/nonexistent/deeply/nested/path/that/cannot/exist",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("[oh-my-harness] postinstall");
  });

  it("logs success message when files are created", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[oh-my-harness] Created");
    expect(result.stdout).toContain("slash-command shim(s)");
  });

  it("does not log on success-no-op (when all files already exist)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    mkdirSync(join(tmpDir, ".opencode", "commands"), { recursive: true });
    for (const name of [
      "harness-on.md",
      "harness-off.md",
      "harness-init.md",
      "harness-check.md",
      "harness-team.md",
    ]) {
      writeFileSync(
        join(tmpDir, ".opencode", "commands", name),
        "existing",
        "utf-8"
      );
    }

    // Pre-create the skill symlink so postinstall sees it as a no-op
    const skillName = "team-architecture-factory";
    const skillDest = join(tmpDir, ".opencode", "skills", skillName);
    const skillSource = join(__dirname, "..", "skills", skillName);
    if (existsSync(skillSource)) {
      mkdirSync(join(tmpDir, ".opencode", "skills"), { recursive: true });
      symlinkSync(relative(dirname(skillDest), skillSource), skillDest);
    }

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("walks up when INIT_CWD points at a .opencode subdir (no nested .opencode/.opencode)", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const opencodeDir = join(tmpDir, ".opencode");
    mkdirSync(opencodeDir, { recursive: true });

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: opencodeDir,
    });

    expect(result.status).toBe(0);

    expect(
      existsSync(join(tmpDir, ".opencode", "commands", "harness-on.md"))
    ).toBe(true);
    expect(
      existsSync(
        join(tmpDir, ".opencode", ".opencode", "commands", "harness-on.md")
      )
    ).toBe(false);
  });

  it("writes shims to the canonical 'commands/' (plural) directory", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(
      existsSync(join(tmpDir, ".opencode", "commands", "harness-on.md"))
    ).toBe(true);
    expect(
      existsSync(join(tmpDir, ".opencode", "command", "harness-on.md"))
    ).toBe(false);
  });

  it("migrates v303 layout: deletes .opencode/command/harness-*.md and removes empty dir", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const legacyDir = join(tmpDir, ".opencode", "command");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "harness-on.md"), "stale", "utf-8");
    writeFileSync(join(legacyDir, "harness-off.md"), "stale", "utf-8");

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(legacyDir, "harness-on.md"))).toBe(false);
    expect(existsSync(join(legacyDir, "harness-off.md"))).toBe(false);
    expect(existsSync(legacyDir)).toBe(false);
    expect(
      existsSync(join(tmpDir, ".opencode", "commands", "harness-on.md"))
    ).toBe(true);
    expect(result.stdout).toContain("Migrated");
  });

  it("migration preserves user-authored files in .opencode/command/", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const legacyDir = join(tmpDir, ".opencode", "command");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "harness-on.md"), "stale", "utf-8");
    writeFileSync(
      join(legacyDir, "user-custom.md"),
      "USER FILE — keep",
      "utf-8"
    );

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(legacyDir, "harness-on.md"))).toBe(false);
    expect(existsSync(join(legacyDir, "user-custom.md"))).toBe(true);
    expect(existsSync(legacyDir)).toBe(true);
    expect(readFileSync(join(legacyDir, "user-custom.md"), "utf-8")).toBe(
      "USER FILE — keep"
    );
  });

  it("migrates nested .opencode/.opencode/command/ junk from INIT_CWD bug", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const nestedDir = join(tmpDir, ".opencode", ".opencode", "command");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, "harness-on.md"), "junk", "utf-8");
    writeFileSync(join(nestedDir, "harness-off.md"), "junk", "utf-8");

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(tmpDir, ".opencode", ".opencode"))).toBe(false);
    expect(
      existsSync(join(tmpDir, ".opencode", "commands", "harness-on.md"))
    ).toBe(true);
  });

  it("no migration log when no legacy files present", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "postinstall-test-"));
    testDirs.push(tmpDir);

    const result = runPostinstall({
      OH_MY_HARNESS_SKIP_POSTINSTALL: undefined,
      INIT_CWD: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Migrated");
    expect(result.stdout).toContain("Created");
  });
});
