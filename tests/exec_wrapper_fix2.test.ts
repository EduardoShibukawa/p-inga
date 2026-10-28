import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T73 (PLAN-0018, judge Codex rodada 2): supersede com wrapper saindo 97
// (sandbox indisponível) sela receipt blocked/infra, nunca pass nem fail.
const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

let repo: string;
let wrap: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pinga-sup97-"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
  mkdirSync(join(repo, "tasks", "TS"), { recursive: true });
  writeFileSync(join(repo, "tasks", "TS", "PLAN.md"), ["---", "mode: mvp", 'goal: "s"', 'done_when: "touch ran.txt"', 'touch: ["ran.txt"]', "---", "c", ""].join("\n"));
  wrap = join(repo, "wrap97.sh");
  writeFileSync(wrap, "#!/bin/sh\nexit 97\n");
  chmodSync(wrap, 0o755);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("supersede: wrapper sai 97 → receipt blocked/infra", () => {
  const r = Bun.spawnSync(["bun", BIN, "supersede", join(repo, "tasks", "TS", "PLAN.md"), "--reason", "teste", "--ledger", join(repo, ".pinga", "l.db")], {
    cwd: repo, env: { ...process.env, PINGA_EXEC_WRAPPER: wrap }, stdout: "pipe", stderr: "pipe",
  });
  expect(r.exitCode).not.toBe(0);
  const out = r.stdout.toString();
  const line = out.split("\n").find((l) => l.includes('"type":"task.receipt"')) ?? "";
  expect(line).toContain('"status":"blocked"');
  expect(line).toContain('"reason_code":"infra"');
});
