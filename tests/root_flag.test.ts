import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

let base: string;
let ws: string; // bundle do workspace: NÃO é repo git
let repo: string; // repo-alvo
let ledger: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "pinga-root-")));
  ws = join(base, "ws");
  repo = join(base, "alvo");
  ledger = join(base, "ledger.db");
  mkdirSync(ws, { recursive: true });
  mkdirSync(repo, { recursive: true });
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function put(root: string, rel: string, text: string): string {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

function git(...a: string[]) {
  return Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...a], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  })
    .stdout.toString()
    .trim();
}

const TASK = (doneWhen: string, touch = '["src/a.ts"]', frozen = "") =>
  [
    "---",
    "type: task",
    "mode: mvp",
    'goal: "g"',
    "plan: PLAN-0005-x",
    `touch: ${touch}`,
    `done_when: ${JSON.stringify(doneWhen)}`,
    ...(frozen ? [`tests_frozen: ${frozen}`] : []),
    "---",
    "corpo",
  ].join("\n") + "\n";

const TASK_PATH = ".ginga/plans/PLAN-0005-x/TASK-01-y.md";

function pinga(args: string[]) {
  const r = Bun.spawnSync(["bun", BIN, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const lines = r.stdout.toString().trim().split("\n").filter(Boolean);
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(lines[lines.length - 1] ?? "");
  } catch {}
  return { code: r.exitCode, json, err: r.stderr.toString(), out: r.stdout.toString() };
}

describe("verify --root", () => {
  test("o done_when roda com cwd na raiz do repo indicado", () => {
    const marker = join(base, "cwd.txt");
    const task = put(ws, TASK_PATH, TASK(`pwd > ${marker}`));
    const r = pinga(["verify", task, "--root", repo, "--ledger", ledger]);
    expect(r.code).toBe(0);
    expect(readFileSync(marker, "utf8").trim()).toBe(repo);
  });

  test("o receipt leva o escopo (repo) do repo indicado, não o do workspace", () => {
    const task = put(ws, TASK_PATH, TASK("true"));
    const r = pinga(["verify", task, "--root", repo, "--ledger", ledger]);
    expect(r.json?.status).toBe("pass");
    expect(r.json?.repo).toBe(join(repo, ".git"));
  });

  test("touch é relativo ao repo indicado: fora do touch → scope_drift; dentro → pass", () => {
    put(repo, "src/a.ts", "export const a = 1;\n");
    put(repo, "src/b.ts", "export const b = 1;\n");
    git("add", "src");
    git("commit", "-q", "-m", "init");
    const task = put(ws, TASK_PATH, TASK("true"));

    put(repo, "src/a.ts", "export const a = 2;\n");
    const dentro = pinga(["verify", task, "--root", repo, "--ledger", ledger, "--base", "HEAD"]);
    expect(dentro.json?.status).toBe("pass");

    put(repo, "src/b.ts", "export const b = 2;\n");
    const fora = pinga(["verify", task, "--root", repo, "--ledger", ledger, "--base", "HEAD"]);
    expect(fora.json?.reason_code).toBe("scope_drift");
    expect(fora.code).toBe(6);
  });

  test("--root que não é repo git sai com 2", () => {
    const task = put(ws, TASK_PATH, TASK("true"));
    const r = pinga(["verify", task, "--root", join(base, "nao-e-repo"), "--ledger", ledger]);
    expect(r.code).toBe(2);
  });

  test("sem --root: igual a hoje (git root a partir da pasta do arquivo)", () => {
    const marker = join(base, "cwd.txt");
    const task = put(repo, "tasks/T7/PLAN.md", TASK(`pwd > ${marker}`));
    const r = pinga(["verify", task, "--ledger", ledger]);
    expect(r.code).toBe(0);
    expect(r.json?.task).toBe("T7");
    expect(readFileSync(marker, "utf8").trim()).toBe(repo);
  });
});

describe("prove-red --root", () => {
  test("tests_frozen e base vêm do repo indicado", () => {
    git("commit", "-q", "--allow-empty", "-m", "init");
    const head = git("rev-parse", "HEAD");
    put(repo, "tests/x.test.ts", "// congelado\n");
    const task = put(ws, TASK_PATH, TASK("test -f tests/x.test.ts && exit 3", '["src/a.ts"]', '["tests/x.test.ts"]'));
    const r = pinga(["prove-red", task, "--root", repo, "--ledger", ledger, "--base", "HEAD"]);
    expect(r.json?.flow).toBe("prove_red");
    expect(r.json?.status).toBe("pass");
    expect(r.json?.base_ref).toBe(head);
    expect(r.json?.repo).toBe(join(repo, ".git"));
  });

  test("--root que não é repo git sai com 2", () => {
    const task = put(ws, TASK_PATH, TASK("exit 3", '["src/a.ts"]', '["tests/x.test.ts"]'));
    const r = pinga(["prove-red", task, "--root", join(base, "nao-e-repo"), "--ledger", ledger]);
    expect(r.code).toBe(2);
  });
});

describe("judge --root e USAGE", () => {
  test("judge com --root que não é repo git sai com 2", () => {
    const task = put(ws, TASK_PATH, TASK("true"));
    const r = pinga(["judge", task, "--root", join(base, "nao-e-repo"), "--ledger", ledger]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/root|repo/i);
  });

  test("USAGE documenta --root em verify, prove-red e judge", () => {
    const r = pinga([]);
    const text = r.out + r.err;
    for (const cmd of ["verify", "prove-red", "judge"]) {
      const linha = text.split("\n").find((l) => l.trim().startsWith(`pinga ${cmd} `));
      expect(linha).toBeDefined();
      expect(linha!).toContain("--root");
    }
  });
});
