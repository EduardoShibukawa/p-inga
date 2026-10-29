import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

describe("verify: holdout com wrapper exit 97 vira blocked/infra (comportamental)", () => {
  let base: string;
  let repo: string;
  let plan: string;
  let ledger: string;
  let holdoutBase: string;
  let extDir: string;
  let wrap: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "pinga-h97-"));
    repo = join(base, "repo");
    holdoutBase = join(base, "holdout");
    extDir = join(base, "ext");
    ledger = join(base, "ledger.db");
    mkdirSync(repo, { recursive: true });
    mkdirSync(holdoutBase, { recursive: true });
    mkdirSync(extDir, { recursive: true });

    const git = (...a: string[]) => {
      const r = Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString()}`);
    };
    git("init", "-q", "-b", "main");
    git("config", "user.name", "T");
    git("config", "user.email", "t@e.c");

    mkdirSync(join(repo, "tasks", "TX"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    plan = join(repo, "tasks", "TX", "PLAN.md");

    const f5 = {
      target: { module: "src/a.ts", export: "f" },
      examples: [
        { name: "h", input: [1], output: 2 },
      ],
      seed: "s",
      holdout: 1,
    };
    // need >=2 examples to have holdout; add one visible
    f5.examples.push({ name: "v", input: [2], output: 2 });
    writeFileSync(join(extDir, "f5.json"), JSON.stringify(f5));

    writeFileSync(join(repo, "src", "a.ts"), "export const f = () => 2;\n");
    writeFileSync(
      plan,
      [
        "---",
        "mode: mvp",
        'goal: "f() === 2"',
        'done_when: "bun test tests/a.test.ts"',
        'touch: ["src/a.ts", "tests/examples/TX.test.ts"]',
        'tests_frozen: ["tests/a.test.ts"]',
        "---",
        "corpo",
      ].join("\n"),
    );
    git("add", "src/a.ts", "tasks/TX/PLAN.md");
    git("commit", "-q", "-m", "chore: init");

    // visible test passing
    mkdirSync(join(repo, "tests"), { recursive: true });
    writeFileSync(join(repo, "tests", "a.test.ts"), 'import { expect, test } from "bun:test";\nimport { f } from "../src/a";\ntest("f() === 2", () => { expect(f()).toBe(2); });\n');
    git("add", "tests/a.test.ts");
    git("commit", "-q", "-m", "test(TX): RED");

    // generate visible + holdout store
    const gen = Bun.spawnSync(["bun", BIN, "examples", plan, "--from", join(extDir, "f5.json")], {
      cwd: repo,
      env: { ...process.env, PINGA_HOLDOUT_DIR: holdoutBase },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (gen.exitCode !== 0) throw new Error(`examples failed: ${gen.stderr.toString()}`);
    git("add", "tests/examples/TX.test.ts");
    git("commit", "-q", "-m", "test(TX): examples");

    // wrapper: exit 97 only on holdout command
    wrap = join(base, "wrap97.sh");
    writeFileSync(wrap, `#!/bin/sh\nroot="$1"; shift\ncase "$*" in *holdout-run*) exit 97 ;; esac\nexec "$@"\n`);
    chmodSync(wrap, 0o755);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("verify receipt blocked/infra quando holdout sai 97", () => {
    const r = Bun.spawnSync(
      ["bun", BIN, "verify", plan, "--ledger", ledger, "--no-baseline", "--allow-no-delta"],
      {
        cwd: repo,
        env: { ...process.env, PINGA_EXEC_WRAPPER: wrap, PINGA_HOLDOUT_DIR: holdoutBase },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const out = r.stdout.toString();
    const line = out.split("\n").find((l) => l.includes('"type":"task.receipt"')) ?? "";
    expect(line).toContain('"status":"blocked"');
    expect(line).toContain('"reason_code":"infra"');
  });
});
