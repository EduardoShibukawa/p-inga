import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function checkIgnore(relPath: string): number {
  const res = Bun.spawnSync(["git", "check-ignore", "-q", "--no-index", relPath], {
    cwd: ROOT,
  });
  return res.exitCode;
}

describe("T00 — repo skeleton", () => {
  test("1. package.json: type=module, private=true, scripts.test='bun test', zero runtime dependencies", () => {
    const raw = readFileSync(join(ROOT, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    expect(pkg.type).toBe("module");
    expect(pkg.private).toBe(true);
    const scripts = pkg.scripts as Record<string, unknown> | undefined;
    expect(scripts?.test).toBe("bun test");
    const deps = pkg.dependencies as Record<string, unknown> | undefined;
    expect(deps === undefined || Object.keys(deps).length === 0).toBe(true);
  });

  test("2. mise.toml: bun='1.4.4', exact hk version, [tasks.pre-commit] runs bun test", () => {
    const raw = readFileSync(join(ROOT, "mise.toml"), "utf8");
    expect(raw).toMatch(/^\s*bun\s*=\s*"1\.4\.4"\s*$/m);
    expect(raw).toMatch(/^\s*hk\s*=\s*"\d+\.\d+\.\d+"\s*$/m);
    expect(raw).not.toMatch(/^\s*hk\s*=\s*"latest"\s*$/m);
    expect(raw).toContain("[tasks.pre-commit]");
    const preCommitSection = raw.split("[tasks.pre-commit]")[1] ?? "";
    expect(preCommitSection).toContain("bun test");
  });

  test("3. hk.pkl: pre-commit hook runs 'mise run pre-commit'", () => {
    const raw = readFileSync(join(ROOT, "hk.pkl"), "utf8");
    expect(raw).toContain("pre-commit");
    expect(raw).toContain("mise run pre-commit");
  });

  test("4. tsconfig.json: compilerOptions.strict === true", () => {
    const raw = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    const tsconfig = JSON.parse(raw) as { compilerOptions?: { strict?: boolean } };
    expect(tsconfig.compilerOptions?.strict).toBe(true);
  });

  test("5. .gitignore ignores raw data, databases, runs, .pinga and node_modules", () => {
    const ignoredPaths = [
      "raw/a.jsonl",
      "state/learn.db",
      "x.db",
      "runs/T00/1/out.txt",
      ".pinga/pinga-stable",
      ".pinga/stable.json",
      "node_modules/x",
    ];
    for (const p of ignoredPaths) {
      expect(checkIgnore(p)).toBe(0);
    }
  });

  test("6. .gitignore does not ignore fixtures, specs and tasks", () => {
    const trackedPaths = [
      "testdata/fixtures/a.jsonl",
      "specs/0001-p-inga-v0.1.md",
      "tasks/T00/PLAN.md",
      "tasks/T00/EVAL.md",
    ];
    for (const p of trackedPaths) {
      expect(checkIgnore(p)).toBe(1);
    }
  });
});
