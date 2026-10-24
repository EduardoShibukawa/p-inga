import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../src/canonical";
import {
  GENERATED_HEADER,
  OVERFIT_EXIT,
  type Example,
  type ExamplesSpec,
  exampleKey,
  examplesPlan,
  holdoutDir,
  holdoutRunnerPath,
  holdoutStorePath,
  parseExamples,
  partitionExamples,
  renderExamplesTest,
  runHoldout,
  visibleTestPath,
} from "../src/examples";
import { validateReceipt } from "../src/receipt";

const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function sha256hex(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

const F5_OBJ = {
  target: { module: "src/double.ts", export: "double" },
  examples: [
    { input: [1], output: 2 },
    { input: [2], output: 4 },
    { input: [3], output: 6 },
    { input: [999001], output: 1998002 },
    { input: [999002], output: 1998004 },
  ],
};

const F5_JSON = JSON.stringify(F5_OBJ, null, 2);
const F5_YAML = [
  "target:",
  "  module: src/double.ts",
  "  export: double",
  "examples:",
  "  - input: [1]",
  "    output: 2",
  "  - input: [2]",
  "    output: 4",
  "  - input: [3]",
  "    output: 6",
  "  - input: [999001]",
  "    output: 1998002",
  "  - input: [999002]",
  "    output: 1998004",
].join("\n");

function makeBaseReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: "task.receipt",
    id: "rcpt-t10-0001",
    task: "TX",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "glm-5.3-flash", family: "glm" },
    verified_by: null,
    summary: "TX pass",
    created_at: "2026-10-24T19:00:00.000Z",
    ...overrides,
  };
}

function collectFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".git") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...collectFilesRecursive(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

describe("T10 — examples sem LLM e holdout reservado (I13 / I14) — Unitários", () => {
  test("1. parseExamples(F5 em JSON) e em YAML -> specs iguais com nomes ex-1..ex-5, holdout 1, seed ''", () => {
    expect(OVERFIT_EXIT).toBe(9);
    expect(GENERATED_HEADER).toBe("// gerado por pinga examples (T10): não editar");

    const j = parseExamples(F5_JSON, "json");
    const y = parseExamples(F5_YAML, "yaml");
    expect(j.ok).toBe(true);
    expect(y.ok).toBe(true);
    if (j.ok && y.ok) {
      expect(j.spec).toEqual(y.spec);
      expect(j.spec.holdout).toBe(1);
      expect(j.spec.seed).toBe("");
      expect(j.spec.examples.map((e) => e.name)).toEqual([
        "ex-1",
        "ex-2",
        "ex-3",
        "ex-4",
        "ex-5",
      ]);
    }
  });

  test("2. default de holdout: n=2->1, n=5->1, n=10->2, n=12->2; holdout:0 explícito->0", () => {
    const makeN = (n: number, holdout?: number) => {
      const obj: Record<string, unknown> = {
        target: { module: "src/double.ts", export: "double" },
        examples: Array.from({ length: n }, (_, i) => ({
          input: [i + 1],
          output: 2 * (i + 1),
        })),
      };
      if (holdout !== undefined) obj.holdout = holdout;
      return parseExamples(JSON.stringify(obj), "json");
    };

    const r2 = makeN(2);
    expect(r2.ok && r2.spec.holdout).toBe(1);
    const r5 = makeN(5);
    expect(r5.ok && r5.spec.holdout).toBe(1);
    const r10 = makeN(10);
    expect(r10.ok && r10.spec.holdout).toBe(2);
    const r12 = makeN(12);
    expect(r12.ok && r12.spec.holdout).toBe(2);
    const r0 = makeN(5, 0);
    expect(r0.ok && r0.spec.holdout).toBe(0);
  });

  test("3. inválidos em parseExamples (cada um ok:false) e acumulação de >= 3 erros", () => {
    const base = () => ({
      target: { module: "src/double.ts", export: "double" },
      examples: [
        { input: [1], output: 2 },
        { input: [2], output: 4 },
      ],
    });

    // 1 exemplo
    expect(
      parseExamples(
        JSON.stringify({
          target: { module: "src/double.ts", export: "double" },
          examples: [{ input: [1], output: 2 }],
        }),
        "json",
      ).ok,
    ).toBe(false);

    // input: 5 (não array)
    expect(
      parseExamples(
        JSON.stringify({
          ...base(),
          examples: [
            { input: 5, output: 10 },
            { input: [2], output: 4 },
          ],
        }),
        "json",
      ).ok,
    ).toBe(false);

    // item sem output
    expect(
      parseExamples(
        JSON.stringify({
          ...base(),
          examples: [{ input: [1] }, { input: [2], output: 4 }],
        }),
        "json",
      ).ok,
    ).toBe(false);

    // item com chave expected
    expect(
      parseExamples(
        JSON.stringify({
          ...base(),
          examples: [
            { input: [1], output: 2, expected: 2 },
            { input: [2], output: 4 },
          ],
        }),
        "json",
      ).ok,
    ).toBe(false);

    // chave extra na raiz
    expect(
      parseExamples(JSON.stringify({ ...base(), extra: true }), "json").ok,
    ).toBe(false);

    // dois input: [1] (input repetido)
    const dupInput = parseExamples(
      JSON.stringify({
        ...base(),
        examples: [
          { input: [1], output: 2 },
          { input: [1], output: 3 },
        ],
      }),
      "json",
    );
    expect(dupInput.ok).toBe(false);
    if (!dupInput.ok) {
      expect(dupInput.errors.some((e) => e.includes("input repetido"))).toBe(true);
    }

    // dois name: "a"
    expect(
      parseExamples(
        JSON.stringify({
          ...base(),
          examples: [
            { name: "a", input: [1], output: 2 },
            { name: "a", input: [2], output: 4 },
          ],
        }),
        "json",
      ).ok,
    ).toBe(false);

    // holdout: 5 com n = 5, holdout: -1, holdout: 1.5
    expect(
      parseExamples(JSON.stringify({ ...F5_OBJ, holdout: 5 }), "json").ok,
    ).toBe(false);
    expect(
      parseExamples(JSON.stringify({ ...F5_OBJ, holdout: -1 }), "json").ok,
    ).toBe(false);
    expect(
      parseExamples(JSON.stringify({ ...F5_OBJ, holdout: 1.5 }), "json").ok,
    ).toBe(false);

    // module inválido e export inválido
    for (const mod of ["../x.ts", "/abs/x.ts", "src/x.py"]) {
      expect(
        parseExamples(
          JSON.stringify({
            ...base(),
            target: { module: mod, export: "double" },
          }),
          "json",
        ).ok,
      ).toBe(false);
    }
    expect(
      parseExamples(
        JSON.stringify({
          ...base(),
          target: { module: "src/x.ts", export: "1x" },
        }),
        "json",
      ).ok,
    ).toBe(false);

    // 3 problemas acumulados -> errors.length >= 3
    const multi = parseExamples(
      JSON.stringify({
        target: { module: "../x.py", export: "1x" },
        extra: 1,
        examples: [{ input: 5 }],
      }),
      "json",
    );
    expect(multi.ok).toBe(false);
    if (!multi.ok) {
      expect(multi.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("4. exampleKey: 64 hex, igual a sha256hex(task + '\\n' + seed + '\\n' + canonicalJson(e))", () => {
    const e: Example = { name: "ex-1", input: [1], output: 2 };
    const k = exampleKey("TX", "s1", e);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).toBe(sha256hex(`TX\ns1\n${canonicalJson(e)}`));
    expect(exampleKey("TY", "s1", e)).not.toBe(k);
    expect(exampleKey("TX", "s2", e)).not.toBe(k);
    expect(exampleKey("TX", "s1", { name: "ex-1", input: [2], output: 4 })).not.toBe(k);
  });

  test("5. partitionExamples(F5, 'TX'): determinístico, 4 visíveis + 1 holdout de menor exampleKey, ordem original preservada, seed muda o sorteio", () => {
    const parsed = parseExamples(F5_JSON, "json");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const spec = parsed.spec;

    const p1 = partitionExamples(spec, "TX");
    const p2 = partitionExamples(spec, "TX");
    expect(p1).toEqual(p2);
    expect(p1.visible.length).toBe(4);
    expect(p1.holdout.length).toBe(1);

    // Menor exampleKey vai para holdout
    const sortedByKey = [...spec.examples].sort((a, b) =>
      exampleKey("TX", spec.seed, a).localeCompare(exampleKey("TX", spec.seed, b)),
    );
    expect(p1.holdout[0]).toEqual(sortedByKey[0]);

    // União e disjunção + ordem original
    const visNames = p1.visible.map((e) => e.name);
    const holdNames = p1.holdout.map((e) => e.name);
    expect(visNames.includes(holdNames[0]!)).toBe(false);
    const origFiltered = spec.examples
      .filter((e) => e.name !== holdNames[0])
      .map((e) => e.name);
    expect(visNames).toEqual(origFiltered);

    // Seeds 'a' a 'z' produzem >= 2 partições diferentes
    const holdoutNamesBySeed = new Set<string>();
    for (let c = 97; c <= 122; c++) {
      const seed = String.fromCharCode(c);
      const part = partitionExamples({ ...spec, seed }, "TX");
      holdoutNamesBySeed.add(part.holdout[0]!.name);
    }
    expect(holdoutNamesBySeed.size).toBeGreaterThanOrEqual(2);
  });

  test("6. renderExamplesTest: função pura, 1ª linha GENERATED_HEADER, 2ª linha metadados, sem vazamento do holdout", () => {
    const parsed = parseExamples(F5_JSON, "json");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { visible, holdout } = partitionExamples(parsed.spec, "TX");

    const r1 = renderExamplesTest({
      task: "TX",
      set: "visible",
      importPath: "../../src/double.ts",
      exportName: "double",
      examples: visible,
    });
    const r2 = renderExamplesTest({
      task: "TX",
      set: "visible",
      importPath: "../../src/double.ts",
      exportName: "double",
      examples: visible,
    });
    expect(r1).toBe(r2);

    const lines = r1.split("\n");
    expect(lines[0]).toBe(GENERATED_HEADER);
    expect(lines[1]).toContain("conjunto visible · 4 exemplos");
    expect(lines[1]).toContain(sha256hex(canonicalJson(visible)));

    const hEx = holdout[0]!;
    expect(r1.includes(canonicalJson(hEx.input))).toBe(false);
    expect(r1.includes(String(hEx.output))).toBe(false);
  });

  test("7. holdoutDir, visibleTestPath, holdoutRunnerPath, holdoutStorePath", () => {
    expect(visibleTestPath("TX")).toBe("tests/examples/TX.test.ts");
    expect(holdoutRunnerPath("TX")).toBe(".pinga/holdout-run/TX.test.ts");
    expect(holdoutDir({ PINGA_HOLDOUT_DIR: "/x" })).toBe("/x");
    expect(holdoutDir({})).toBe(join(homedir(), ".local/state/pinga/holdout"));
    expect(holdoutDir({ PINGA_HOLDOUT_DIR: "" })).toBe(
      join(homedir(), ".local/state/pinga/holdout"),
    );

    const d1 = mkdtempSync(join(tmpdir(), "pinga-t10-r1-"));
    const d2 = mkdtempSync(join(tmpdir(), "pinga-t10-r2-"));
    try {
      const p1 = holdoutStorePath(d1, "TX", { PINGA_HOLDOUT_DIR: "/tmp/h" });
      const p2 = holdoutStorePath(d2, "TX", { PINGA_HOLDOUT_DIR: "/tmp/h" });
      expect(p1).not.toBe(p2);
    } finally {
      rmSync(d1, { recursive: true, force: true });
      rmSync(d2, { recursive: true, force: true });
    }
  });

  test("8. validateReceipt aceita fail/overfit_holdout", () => {
    const res = validateReceipt(
      makeBaseReceipt({ status: "fail", reason_code: "overfit_holdout" }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("T10 — examples sem LLM e holdout reservado (I13 / I14) — CLI & verify", () => {
  function makeTempEnv() {
    const baseDir = mkdtempSync(join(tmpdir(), "pinga-t10-cli-"));
    const repoDir = join(baseDir, "repo");
    const holdoutBase = join(baseDir, "holdout");
    const extDir = join(baseDir, "ext");
    const ledgerPath = join(baseDir, "ledger.db");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(holdoutBase, { recursive: true });
    mkdirSync(extDir, { recursive: true });

    const git = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], {
        cwd: repoDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (r.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
      }
    };

    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("checkout", "-q", "-b", "feat/x");

    writeFileSync(join(repoDir, ".gitignore"), "runs/\n.pinga/\n*.db\n");
    mkdirSync(join(repoDir, "tasks/TX"), { recursive: true });
    mkdirSync(join(repoDir, "src"), { recursive: true });

    const planPath = join(repoDir, "tasks/TX/PLAN.md");
    writeFileSync(
      planPath,
      [
        "---",
        "mode: padrao",
        'goal: "Implementar double"',
        'done_when: "bun test tests/examples/TX.test.ts"',
        'touch: ["src/double.ts"]',
        'tests_frozen: ["tests/examples/TX.test.ts"]',
        "---",
        "## Passos",
        "- [ ] 1",
        "## Dívidas conscientes",
        "- nenhuma",
        "## Fora",
        "- nada",
      ].join("\n"),
    );

    writeFileSync(
      join(repoDir, "src/double.ts"),
      "export const double = (n: number): number => 2 * n;\n",
    );

    git("add", ".gitignore", "tasks/TX/PLAN.md", "src/double.ts");
    git("commit", "-q", "-m", "chore: init");

    const f5Path = join(extDir, "f5.json");
    // Usamos uma seed que garante que um dos exemplos 9990xx caia no holdout
    // ou verificamos qual caiu no holdout para testar vazamentos.
    writeFileSync(f5Path, F5_JSON);

    const runCli = (...args: string[]) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        PINGA_HOLDOUT_DIR: holdoutBase,
      };
      delete env.PINGA_MODE_NIGHT;
      const r = Bun.spawnSync(["bun", BIN, ...args], {
        cwd: repoDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        exitCode: r.exitCode,
        stdout: r.stdout.toString(),
        stderr: r.stderr.toString(),
      };
    };

    return {
      baseDir,
      repoDir,
      holdoutBase,
      extDir,
      ledgerPath,
      planPath,
      f5Path,
      runCli,
      cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
    };
  }

  test("9–12. CLI pinga examples: geração, idempotência, recusa dentro do repo e execução do teste gerado", () => {
    const env = makeTempEnv();
    try {
      const parsedF5 = parseExamples(F5_JSON, "json");
      if (!parsedF5.ok) throw new Error("unexpected");
      const part = partitionExamples(parsedF5.spec, "TX");
      const holdoutEx = part.holdout[0]!;

      // 9. pinga examples <plan> --from <F5>
      const r9 = env.runCli("examples", env.planPath, "--from", env.f5Path);
      expect(r9.exitCode).toBe(0);
      const out9 = JSON.parse(r9.stdout.trim());
      expect(out9.task).toBe("TX");
      expect(out9.visible).toBe(4);
      expect(out9.holdout).toBe(1);
      expect(out9.test).toBe("tests/examples/TX.test.ts");
      expect(out9.holdout_sha256).toMatch(/^[0-9a-f]{64}$/);

      const storeFile = holdoutStorePath(env.repoDir, "TX", {
        PINGA_HOLDOUT_DIR: env.holdoutBase,
      });
      expect(existsSync(storeFile)).toBe(true);
      expect(sha256hex(readFileSync(storeFile))).toBe(out9.holdout_sha256);

      const st = Bun.spawnSync(["git", "status", "--porcelain"], {
        cwd: env.repoDir,
        stdout: "pipe",
      })
        .stdout.toString()
        .trim();
      expect(st).toBe("?? tests/");

      // Nenhum arquivo do repo contém o output do exemplo do holdout (como JSON isolado / valor único)
      // Nota: para evitar colisão de dígito curto (ex: '2'), testamos também que o teste gerado não contém a entrada/saída do holdout
      const testContent = readFileSync(
        join(env.repoDir, "tests/examples/TX.test.ts"),
        "utf8",
      );
      expect(testContent.includes(JSON.stringify(holdoutEx.name))).toBe(false);

      // 10. Idempotência: 2ª execução igual -> exit 0
      const storeBytesBefore = readFileSync(storeFile, "utf8");
      const r10a = env.runCli("examples", env.planPath, "--from", env.f5Path);
      expect(r10a.exitCode).toBe(0);
      expect(readFileSync(join(env.repoDir, "tests/examples/TX.test.ts"), "utf8")).toBe(
        testContent,
      );
      expect(readFileSync(storeFile, "utf8")).toBe(storeBytesBefore);

      // Trocando um output -> exit 1, stderr contém 'já existe e difere', arquivos intactos
      const modF5 = join(env.extDir, "f5-mod.json");
      const modObj = structuredClone(F5_OBJ);
      modObj.examples[0]!.output = 999;
      modObj.examples[1]!.output = 888;
      writeFileSync(modF5, JSON.stringify(modObj));
      const r10b = env.runCli("examples", env.planPath, "--from", modF5);
      expect(r10b.exitCode).toBe(1);
      expect(r10b.stderr).toContain("já existe e difere");
      expect(readFileSync(join(env.repoDir, "tests/examples/TX.test.ts"), "utf8")).toBe(
        testContent,
      );
      expect(readFileSync(storeFile, "utf8")).toBe(storeBytesBefore);

      // 11. --from apontando para arquivo dentro do repo -> exit 2, 'vazam o holdout'
      const env2 = makeTempEnv();
      try {
        const insidePath = join(env2.repoDir, "in-repo.json");
        writeFileSync(insidePath, F5_JSON);
        const r11a = env2.runCli("examples", env2.planPath, "--from", insidePath);
        expect(r11a.exitCode).toBe(2);
        expect(r11a.stderr).toContain("vazam o holdout");
        expect(existsSync(join(env2.repoDir, "tests/examples/TX.test.ts"))).toBe(false);

        const r11b = env2.runCli("examples", env2.planPath);
        expect(r11b.exitCode).toBe(2);
      } finally {
        env2.cleanup();
      }

      // 12. Teste gerado roda: double = 2*n -> exit 0; double = n -> exit != 0
      const tPass = Bun.spawnSync(
        ["bun", "test", "tests/examples/TX.test.ts"],
        { cwd: env.repoDir, stdout: "pipe", stderr: "pipe" },
      );
      expect(tPass.exitCode).toBe(0);

      writeFileSync(
        join(env.repoDir, "src/double.ts"),
        "export const double = (n: number): number => n;\n",
      );
      const tFail = Bun.spawnSync(
        ["bun", "test", "tests/examples/TX.test.ts"],
        { cwd: env.repoDir, stdout: "pipe", stderr: "pipe" },
      );
      expect(tFail.exitCode).not.toBe(0);
    } finally {
      env.cleanup();
    }
  });

  test("13–18. verify com holdout: pass, overfit (exit 9), disjuntor (exit 4), falha visível (exit 1), sem store e ledger verify", () => {
    // Usamos uma fixture onde todos os outputs têm 6 dígitos para testar ausência de vazamento por substring em qualquer arquivo!
    const f5LeakCheck = {
      target: { module: "src/double.ts", export: "double" },
      examples: [
        { input: [999001], output: 1998002 },
        { input: [999002], output: 1998004 },
        { input: [999003], output: 1998006 },
        { input: [999004], output: 1998008 },
        { input: [999005], output: 1998010 },
      ],
    };

    const env = makeTempEnv();
    try {
      const f5Path = join(env.extDir, "f5-leak.json");
      writeFileSync(f5Path, JSON.stringify(f5LeakCheck));
      const parsed = parseExamples(JSON.stringify(f5LeakCheck), "json");
      if (!parsed.ok) throw new Error("unexpected");
      const part = partitionExamples(parsed.spec, "TX");
      const holdoutOutputStr = String(part.holdout[0]!.output);

      const gen = env.runCli("examples", env.planPath, "--from", f5Path);
      expect(gen.exitCode).toBe(0);

      const printedReceipts: unknown[] = [];

      // 13. verify com implementação correta -> exit 0, pass, evidence.length === 2, summary termina com 'holdout ok'
      writeFileSync(
        join(env.repoDir, "src/double.ts"),
        "export const double = (n: number): number => 2 * n;\n",
      );
      const r13 = env.runCli("verify", env.planPath, "--ledger", env.ledgerPath);
      expect(r13.exitCode).toBe(0);
      const rcpt13 = JSON.parse(r13.stdout.trim());
      printedReceipts.push(rcpt13);
      expect(rcpt13.status).toBe("pass");
      expect(rcpt13.evidence.length).toBe(2);
      expect(rcpt13.evidence[1].exit).toBe(0);
      expect(rcpt13.evidence[1].artifact_ref.path.startsWith(env.holdoutBase)).toBe(
        true,
      );
      expect(rcpt13.summary.endsWith("holdout ok")).toBe(true);
      expect(existsSync(join(env.repoDir, ".pinga/holdout-run/TX.test.ts"))).toBe(
        false,
      );

      // 14. verify com overfit: tabela montada a partir de visible -> exit 9, fail/overfit_holdout, sem vazamento
      const tableEntries = part.visible
        .map((e) => `${JSON.stringify((e.input as number[])[0])}: ${JSON.stringify(e.output)}`)
        .join(", ");
      writeFileSync(
        join(env.repoDir, "src/double.ts"),
        `const TABLE: Record<number, number> = { ${tableEntries} };\nexport const double = (n: number): number => TABLE[n] ?? 0;\n`,
      );
      const r14 = env.runCli("verify", env.planPath, "--ledger", env.ledgerPath);
      expect(r14.exitCode).toBe(9);
      const rcpt14 = JSON.parse(r14.stdout.trim());
      printedReceipts.push(rcpt14);
      expect(rcpt14.status).toBe("fail");
      expect(rcpt14.reason_code).toBe("overfit_holdout");
      expect(rcpt14.evidence[0].exit).toBe(0);
      expect(rcpt14.evidence[1].exit).not.toBe(0);
      expect(rcpt14.breaker?.tripped).toBe(false);
      expect(r14.stdout.includes(holdoutOutputStr)).toBe(false);
      expect(existsSync(join(env.repoDir, ".pinga/holdout-run/TX.test.ts"))).toBe(
        false,
      );
      for (const file of collectFilesRecursive(env.repoDir)) {
        const content = readFileSync(file, "utf8");
        expect(content.includes(holdoutOutputStr)).toBe(false);
      }

      // 15. Mesmo overfit de novo -> exit 4, blocked/breaker_same_failure
      const r15 = env.runCli("verify", env.planPath, "--ledger", env.ledgerPath);
      expect(r15.exitCode).toBe(4);
      const rcpt15 = JSON.parse(r15.stdout.trim());
      printedReceipts.push(rcpt15);
      expect(rcpt15.status).toBe("blocked");
      expect(rcpt15.reason_code).toBe("breaker_same_failure");

      // 16. Visível falhando (double = (n) => n) -> exit 1, command_failed, evidence.length === 1, nenhum arquivo novo em <PINGA_HOLDOUT_DIR>/runs
      const runsDir = join(env.holdoutBase, "runs");
      const beforeRunsFiles = existsSync(runsDir)
        ? collectFilesRecursive(runsDir)
        : [];
      writeFileSync(
        join(env.repoDir, "src/double.ts"),
        "export const double = (n: number): number => n;\n",
      );
      const r16 = env.runCli("verify", env.planPath, "--ledger", env.ledgerPath);
      expect(r16.exitCode).toBe(1);
      const rcpt16 = JSON.parse(r16.stdout.trim());
      printedReceipts.push(rcpt16);
      expect(rcpt16.reason_code).toBe("command_failed");
      expect(rcpt16.evidence.length).toBe(1);
      const afterRunsFiles = existsSync(runsDir)
        ? collectFilesRecursive(runsDir)
        : [];
      expect(afterRunsFiles.length).toBe(beforeRunsFiles.length);

      // 17. Sem store (apagando o store da task) -> evidence.length === 1, exit 0
      const storeFile = holdoutStorePath(env.repoDir, "TX", {
        PINGA_HOLDOUT_DIR: env.holdoutBase,
      });
      rmSync(storeFile, { force: true });
      writeFileSync(
        join(env.repoDir, "src/double.ts"),
        "export const double = (n: number): number => 2 * n;\n",
      );
      const r17 = env.runCli("verify", env.planPath, "--ledger", env.ledgerPath);
      expect(r17.exitCode).toBe(0);
      const rcpt17 = JSON.parse(r17.stdout.trim());
      printedReceipts.push(rcpt17);
      expect(rcpt17.evidence.length).toBe(1);

      // 18. Integração: validateReceipt + ledger verify
      for (const rcpt of printedReceipts) {
        const v = validateReceipt(rcpt);
        expect(v.ok).toBe(true);
      }
      const lv = env.runCli("ledger", "verify", "--ledger", env.ledgerPath);
      expect(lv.exitCode).toBe(0);
      expect(lv.stdout.trim()).toBe(`ok ${printedReceipts.length}`);
    } finally {
      env.cleanup();
    }
  });
});
