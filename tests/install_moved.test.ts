import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { runPinga, tmp } from "./helpers/home";

const home = tmp("pinga-moved-home-");
mkdirSync(home, { recursive: true });
const env = { HOME: home, XDG_STATE_HOME: home, TMPDIR: home };

describe("T78 — install/adopt movidos para ginga install — tests/install_moved.test.ts", () => {
  test("1. pinga install --dry-run → exit 2 apontando para ginga install", () => {
    const r = runPinga(["install", "--dry-run"], env);
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain("ginga install");
    expect(r.stderr).toContain("movido");
  });

  test("2. pinga adopt --apply → exit 2 com a mesma mensagem", () => {
    const r = runPinga(["adopt", "--apply"], env);
    expect(r.exit).toBe(2);
    expect(r.stderr).toContain("ginga install");
  });

  test("3. sem flags também sai 2 (comando virou mensagem)", () => {
    expect(runPinga(["install"], env).exit).toBe(2);
    expect(runPinga(["adopt"], env).exit).toBe(2);
  });

  test("4. USAGE cita o comando movido", () => {
    const r = runPinga([], env);
    expect(r.exit).toBe(2);
    expect(r.stdout + r.stderr).toContain("ginga install");
  });
});
