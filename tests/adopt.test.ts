import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptLocalEntries,
  classifyAdoptTarget,
  inspectAdoptableEntries,
} from "../src/adopt";
import { runCli } from "../src/cli";
import { readManifest } from "../src/manifest";

describe("T18 — pinga adopt for pre-existing local entries & broken symlinks", () => {
  let tmp: string;
  let home: string;
  let manifestPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pinga-t18-"));
    home = join(tmp, "home");
    mkdirSync(home, { recursive: true });
    manifestPath = join(tmp, "state/pinga/manifest.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("1. classifyAdoptTarget and inspectAdoptableEntries locate unowned local entries and broken symlinks", async () => {
    expect(
      classifyAdoptTarget({
        target: "claude-local",
        exists: true,
        is_owned: false,
        is_broken_symlink: false,
      }),
    ).toBe("adoptable");
    expect(
      classifyAdoptTarget({
        target: "pi-symlink",
        exists: false,
        is_owned: false,
        is_broken_symlink: true,
      }),
    ).toBe("broken_symlink");

    // Create pre-existing Claude settings.json + installed_plugins.json and broken symlink in pi
    mkdirSync(join(home, ".claude/plugins"), { recursive: true });
    writeFileSync(
      join(home, ".claude/settings.json"),
      JSON.stringify({
        theme: "dark",
        enabledPlugins: { "pi-harness@pi-harness-local": true },
      }),
    );
    writeFileSync(
      join(home, ".claude/plugins/installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "pi-harness@pi-harness-local": [{ scope: "user", installPath: "/old" }],
        },
      }),
    );
    mkdirSync(join(home, ".pi/agent/extensions"), { recursive: true });
    symlinkSync(
      "/nonexistent/legacy/pi-harness.ts",
      join(home, ".pi/agent/extensions/pi-harness.ts"),
    );

    const targets = await inspectAdoptableEntries(home, manifestPath);
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets.some((t) => t.status === "adoptable")).toBe(true);
    expect(targets.some((t) => t.status === "broken_symlink")).toBe(true);
  });

  test("2. adoptLocalEntries dry-run inspects without mutating disk or creating manifest", async () => {
    mkdirSync(join(home, ".config/opencode/plugins"), { recursive: true });
    const ocPlugin = join(home, ".config/opencode/plugins/pi-harness.js");
    writeFileSync(ocPlugin, "// legacy plugin");

    const res = await adoptLocalEntries({
      homeDir: home,
      manifestPath,
      apply: false,
    });
    expect(res.inspected).toBeGreaterThanOrEqual(1);
    expect(res.adopted).toBe(1);
    expect(res.backups_created.length).toBe(0);
    expect(existsSync(manifestPath)).toBe(false);
    expect(existsSync(ocPlugin)).toBe(true);
  });

  test("3, 4, 5 & 6. adoptLocalEntries --apply backs up SHA-256, cleans broken symlinks, writes manifest (adopted: true), and is idempotent", async () => {
    mkdirSync(join(home, ".config/opencode/plugins"), { recursive: true });
    const ocPlugin = join(home, ".config/opencode/plugins/pi-harness.js");
    writeFileSync(ocPlugin, "// legacy plugin content");

    mkdirSync(join(home, ".pi/agent/extensions"), { recursive: true });
    const brokenSym = join(home, ".pi/agent/extensions/pi-harness.ts");
    symlinkSync("/nonexistent/legacy/pi-harness.ts", brokenSym);

    const first = await adoptLocalEntries({
      homeDir: home,
      manifestPath,
      apply: true,
    });
    expect(first.adopted).toBe(1);
    expect(first.cleaned).toBe(1);
    expect(first.backups_created.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(first.backups_created[0]!)).toBe(true);

    // Broken symlink was removed
    let symStillExists = false;
    try {
      lstatSync(brokenSym);
      symStillExists = true;
    } catch {
      symStillExists = false;
    }
    expect(symStillExists).toBe(false);

    // Manifest has adopted: true entry
    const manifest = readManifest(manifestPath);
    expect(manifest.entries.length).toBe(1);
    expect(
      (manifest.entries[0] as unknown as { adopted?: boolean }).adopted,
    ).toBe(true);

    // Second run is idempotent
    const second = await adoptLocalEntries({
      homeDir: home,
      manifestPath,
      apply: true,
    });
    expect(second.adopted).toBe(0);
    expect(second.cleaned).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
  });

  test("7, 8, 9 & 10. Empty HOME, user keys preserved, and CLI pinga adopt (--dry-run | --apply)", async () => {
    const emptyRes = await adoptLocalEntries({
      homeDir: home,
      manifestPath,
      apply: true,
    });
    expect(emptyRes.adopted).toBe(0);
    expect(emptyRes.cleaned).toBe(0);

    mkdirSync(join(home, ".claude"), { recursive: true });
    const settingsPath = join(home, ".claude/settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: "solarized",
        model: "opus",
        enabledPlugins: { "pi-harness@pi-harness-local": true },
      }),
    );

    const dryExit = await runCli([
      "adopt",
      "--dry-run",
      "--home",
      home,
      "--manifest",
      manifestPath,
    ]);
    expect(dryExit).toBe(0);

    const applyExit = await runCli([
      "adopt",
      "--apply",
      "--home",
      home,
      "--manifest",
      manifestPath,
    ]);
    expect(applyExit).toBe(0);

    // User keys preserved
    const afterSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(afterSettings.theme).toBe("solarized");
    expect(afterSettings.model).toBe("opus");
  });
});
