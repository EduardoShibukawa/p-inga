import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openLedger } from "../src/ledger";

/**
 * T904 (PLAN-0003, monorepo): o pinga com `--root` numa subpasta de um
 * repositório git. Cada pacote tem os seus `tasks/T<N>/`; o mesmo número em
 * dois pacotes não colide, mudança em outro pacote não é fuga de escopo, e os
 * receipts gravados quando o pacote era um repositório separado continuam valendo.
 */
const BIN = join(import.meta.dir, "..", "bin", "pinga.ts");
let repo: string;
let ledger: string;
const dirs: string[] = [];

function git(...a: string[]) {
  const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString().trim();
}
function put(rel: string, text: string) {
  const p = join(repo, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
function pinga(pkg: string, ...args: string[]) {
  const r = Bun.spawnSync(["bun", BIN, ...args, "--ledger", ledger], { cwd: join(repo, pkg), stdout: "pipe", stderr: "pipe" });
  const out = r.stdout.toString().trim();
  let json: any = null;
  try {
    json = JSON.parse(out.split("\n").pop() ?? "");
  } catch {}
  return { code: r.exitCode, out, err: r.stderr.toString(), json };
}
const CONTRACT = '---\nmode: mvp\ngoal: "cria src/x.txt"\ndone_when: "bun test tests/x.test.ts"\ntouch: ["src/x.txt", "tests/x.test.ts", "tasks/T1/PLAN.md"]\ntests_frozen: ["tests/x.test.ts"]\n---\n';
const X_TEST = 'import { expect, test } from "bun:test";\nimport { existsSync } from "node:fs";\ntest("x", () => expect(existsSync("src/x.txt")).toBe(true));\n';

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "pinga-mono-")));
  const aux = realpathSync(mkdtempSync(join(tmpdir(), "pinga-mono-aux-")));
  dirs.push(repo, aux);
  ledger = join(aux, "ledger.db");
  git("init", "-q", "-b", "main");
  put(".gitignore", "runs/\n.pinga/\n");
  put("a/src/base.txt", "a\n");
  put("b/src/base.txt", "b\n");
  put("b/tasks/T1/PLAN.md", CONTRACT.replace("cria src/x.txt", "outra coisa em b"));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  // RED do pacote a
  put("a/tasks/T1/PLAN.md", CONTRACT);
  put("a/tests/x.test.ts", X_TEST);
  git("add", ".");
  git("commit", "-q", "-m", "test(T1): RED");
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("pinga com --root numa subpasta do repositório", () => {
  test("prove-red prova o RED do pacote no commit base", () => {
    const r = pinga("a", "prove-red", "tasks/T1/PLAN.md", "--root", join(repo, "a"));
    expect(r.json?.status).toBe("pass");
    expect(r.json?.flow).toBe("prove_red");
  });

  test("verify passa com mudança pendente em OUTRO pacote: não é fuga de escopo", () => {
    put("a/src/x.txt", "x\n");
    git("add", "a");
    git("commit", "-q", "-m", "feat(T1): x");
    put("b/src/solto.txt", "trabalho de outro pacote, sem commit\n");
    const r = pinga("a", "verify", "tasks/T1/PLAN.md", "--root", join(repo, "a"));
    expect(r.json?.reason_code).toBeNull();
    expect(r.json?.status).toBe("pass");
  });

  test("o receipt é do pacote: escopo = repositório + pasta", () => {
    const led = openLedger(ledger);
    const bodies = led.all().map((r) => JSON.parse(r.body));
    led.close();
    const pass = bodies.filter((b) => b.task === "T1" && b.status === "pass" && b.flow !== "prove_red");
    expect(pass.length).toBeGreaterThan(0);
    for (const b of pass) expect(b.repo).toMatch(/\.git#a$/);
  });

  test("o mesmo T1 em outro pacote não herda o receipt (gate 12), e o do pacote passa (gate 0)", () => {
    expect(pinga("a", "gate", "--root", join(repo, "a"), "T1").code).toBe(0);
    const b = pinga("b", "gate", "--root", join(repo, "b"), "T1");
    expect(b.code).toBe(12);
    expect(b.json?.pending).toEqual(["T1"]);
  });

  test("receipt antigo, de quando o pacote era um repositório separado, continua valendo só para ele", () => {
    const led = openLedger(ledger);
    const old = (task: string, scope: string) =>
      led.append({ v: 1, type: "task.receipt", id: `old-${Math.random()}`, task, status: "pass", reason_code: null, attempts: 1, evidence: [], tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: "not run", author: { model: null, family: null }, verified_by: null, summary: "antigo", created_at: "2026-11-01T00:00:00.000Z", flow: "verify", repo: scope });
    old("T1", "/antes/workspace/outro/.git"); // repo separado de OUTRO pacote: não vale
    led.close();
    expect(pinga("b", "gate", "--root", join(repo, "b"), "T1").code).toBe(12);
    const led2 = openLedger(ledger);
    led2.append({ v: 1, type: "task.receipt", id: "old-b", task: "T1", status: "pass", reason_code: null, attempts: 1, evidence: [], tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: "not run", author: { model: null, family: null }, verified_by: null, summary: "antigo", created_at: "2026-11-01T00:00:00.000Z", flow: "verify", repo: "/antes/workspace/b/.git" });
    led2.close();
    expect(pinga("b", "gate", "--root", join(repo, "b"), "T1").code).toBe(0);
  });

  test("mudança fora do touch DENTRO do pacote continua sendo fuga de escopo", () => {
    put("a/src/fora.txt", "não está no touch\n");
    const r = pinga("a", "verify", "tasks/T1/PLAN.md", "--root", join(repo, "a"));
    expect(r.json?.reason_code).toBe("scope_drift");
    rmSync(join(repo, "a/src/fora.txt"));
  });
});
