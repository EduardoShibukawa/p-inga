import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SPEC = join(ROOT, "specs/draft-0008-ux-unificado-p-inga.md");
const GATE = join(ROOT, "tasks/T50/evidence/gate.md");
const VERDICT = "(keep|drop|merge|reframe)";
const read = (p: string) => readFileSync(p, "utf8");

const ids = (): string[] => [
  ...new Set([...read(SPEC).matchAll(/^\|\s*([WTD]\d+)\s*\|/gm)].map((m) => m[1])),
];

function execPlans() {
  const dir = join(ROOT, "tasks");
  return readdirSync(dir)
    .filter((d) => /^T5[1-3]$/.test(d))
    .map((d) => join(dir, d, "PLAN.md"))
    .filter((p) => existsSync(p))
    .map((p) => ({ path: p, txt: read(p) }));
}

function cobre(txt: string): string[] {
  const m = txt.match(/^cobre:\s*\[(.*)\]\s*$/m);
  return (m?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

describe("T50 · gate adversarial da spec 0008", () => {
  test("spec aprovada e todo achado com veredito no gate.md", () => {
    expect(read(SPEC)).toMatch(/^Status: approved$/m);
    const gate = read(GATE);
    const all = ids();
    expect(all.length).toBeGreaterThanOrEqual(18);
    for (const id of all) {
      expect(gate).toMatch(new RegExp(`\\|\\s*${id}\\s*\\|[^|\\n]*\\b${VERDICT}\\b`, "i"));
    }
  });

  test("tasks de execucao declaram cobertura disjunta e completa", () => {
    const plans = execPlans();
    expect(plans.length).toBeGreaterThanOrEqual(3);
    const owner = new Map<string, string>();
    for (const p of plans) {
      const cov = cobre(p.txt);
      expect(cov.length).toBeGreaterThan(0);
      for (const id of cov) {
        expect(owner.has(id)).toBe(false);
        owner.set(id, p.path);
      }
    }
    for (const id of ids()) expect(owner.has(id)).toBe(true);
  });

  test("done_when existe e nenhum touch aponta para arquivo de codigo fantasma", () => {
    for (const p of execPlans()) {
      expect(p.txt).toMatch(/^done_when:\s*\S/m);
      const fm = p.txt.split("---")[1] ?? "";
      const touch = [...fm.matchAll(/^\s*-\s*(\S+)\s*$/gm)].map((m) => m[1]);
      expect(touch.length).toBeGreaterThan(0);
      for (const rel of touch) {
        if (/^(tasks|specs)\//.test(rel)) continue;
        expect(existsSync(join(ROOT, rel))).toBe(true);
      }
    }
  });
});
