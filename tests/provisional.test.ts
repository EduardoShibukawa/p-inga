import { describe, expect, test } from "bun:test";
import { evaluateGuards, isProvisionalTest } from "../src/guards";
import { checkGiraStatus } from "../src/doctor";

describe("T21 — Testes Provisionais (Scratchpad TDD) & Gira-G", () => {
  test("1. isProvisionalTest classifica deterministicamente caminhos de teste provisório", () => {
    // Casos válidos de testes provisórios
    expect(isProvisionalTest("tests/provisional/test_feature.py")).toBe(true);
    expect(isProvisionalTest("tests/provisional/foo.test.ts")).toBe(true);
    expect(isProvisionalTest("tests/scratch/my_scratch.py")).toBe(true);
    expect(isProvisionalTest("tests/scratch_feature.py")).toBe(true);
    expect(isProvisionalTest("tests/test_scratch_lease.py")).toBe(true);
    expect(isProvisionalTest("tests/sub/scratch_test.py")).toBe(true);
    expect(isProvisionalTest(".pinga/scratch/test_demo.py")).toBe(true);
    expect(isProvisionalTest("src/module.scratch.test.ts")).toBe(true);

    // Casos de arquivos normais (não provisórios)
    expect(isProvisionalTest("tests/test_basic.py")).toBe(false);
    expect(isProvisionalTest("tests/guards.test.ts")).toBe(false);
    expect(isProvisionalTest("src/guards.ts")).toBe(false);
    expect(isProvisionalTest("package.json")).toBe(false);
    expect(isProvisionalTest("tasks/T21/PLAN.md")).toBe(false);
    // Escapes e vazios
    expect(isProvisionalTest("")).toBe(false);
    expect(isProvisionalTest("../tests/scratch_foo.py")).toBe(false);
  });

  test("2. evaluateGuards concede imunidade a testes provisórios contra tests_frozen_changed e scope_drift", () => {
    const inputWithProvisional = {
      task: "T21",
      touch: ["src/guards.ts"],
      tests_frozen: ["tests/provisional.test.ts", "tests/scratch_foo.py"],
      changed: ["src/guards.ts", "tests/scratch_foo.py", "tests/provisional/test_bar.py"],
    };

    const res = evaluateGuards(inputWithProvisional);
    expect(res.ok).toBe(true);
  });

  test("3. evaluateGuards continua bloqueando alteração em testes oficiais congelados", () => {
    const inputTamperedOfficial = {
      task: "T21",
      touch: ["src/guards.ts"],
      tests_frozen: ["tests/provisional.test.ts"],
      changed: ["src/guards.ts", "tests/provisional.test.ts"],
    };

    const res = evaluateGuards(inputTamperedOfficial);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason_code).toBe("tests_frozen_changed");
      expect(res.exit).toBe(5);
      expect(res.files).toEqual(["tests/provisional.test.ts"]);
    }
  });

  test("4. evaluateGuards continua bloqueando scope_drift em código de produção", () => {
    const inputScopeDrift = {
      task: "T21",
      touch: ["src/guards.ts"],
      changed: ["src/guards.ts", "src/extra.ts"],
    };

    const res = evaluateGuards(inputScopeDrift);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason_code).toBe("scope_drift");
      expect(res.exit).toBe(6);
      expect(res.files).toEqual(["src/extra.ts"]);
    }
  });

  test("5. checkGiraStatus detecta presença do gira CLI", () => {
    const status = checkGiraStatus();
    expect(status).toHaveProperty("ok");
    expect(typeof status.ok).toBe("boolean");
    expect(status).toHaveProperty("message");
  });

  test("6. CLI pinga tdd list detecta testes provisórios no repositório", () => {
    const proc = Bun.spawnSync(
      ["bun", "src/cli.ts", "tdd", "list"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }
    );
    expect(proc.exitCode).toBe(0);
  });
});
