import { describe, expect, test } from "bun:test";
import { parsePlan } from "../src/plan";

function doc(extra: string[] = [], base: string[] = ["mode: mvp", 'goal: "g"', 'done_when: "true"']) {
  return ["---", ...base, ...extra, "---", "corpo"].join("\n") + "\n";
}

function errors(text: string): string {
  const r = parsePlan(text);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.errors.join("\n");
}

describe("parsePlan: campos opcionais da TASK nova", () => {
  test("aceita type task, title, plan, repo, depends_on e tier juntos", () => {
    const r = parsePlan(
      doc([
        "type: task",
        "title: Algum título",
        "plan: PLAN-0005-pinga-task-e-plan",
        "repo: p-inga",
        "depends_on: [TASK-01-schema-task]",
        "tier: medium",
      ]),
    );
    expect(r.ok).toBe(true);
  });

  test("depends_on vazio e cada tier válido passam", () => {
    for (const tier of ["free", "medium", "strong"]) {
      expect(parsePlan(doc(["depends_on: []", `tier: ${tier}`])).ok).toBe(true);
    }
  });

  test("tier fora de free|medium|strong é erro", () => {
    expect(errors(doc(["tier: gigante"]))).toContain("tier");
  });

  test("depends_on que não é array de strings é erro", () => {
    expect(errors(doc(["depends_on: TASK-01"]))).toContain("depends_on");
    expect(errors(doc(["depends_on: [1, 2]"]))).toContain("depends_on");
  });

  test("title, plan e repo que não são string são erro", () => {
    expect(errors(doc(["title: 5"]))).toContain("title");
    expect(errors(doc(["plan: [a]"]))).toContain("plan");
    expect(errors(doc(["repo: 7"]))).toContain("repo");
  });

  test("type diferente de task é erro", () => {
    expect(errors(doc(["type: banana"]))).toContain("type");
  });

  test("type: plan manda usar pinga verify em modo PLAN", () => {
    expect(errors(doc(["type: plan"]))).toContain("use pinga verify em modo PLAN");
  });
});

describe("parsePlan: o que não muda", () => {
  test("obrigatórios continuam obrigatórios", () => {
    expect(errors(doc([], ['goal: "g"', 'done_when: "true"']))).toContain("mode");
    expect(errors(doc([], ["mode: mvp", 'done_when: "true"']))).toContain("goal");
    expect(errors(doc([], ["mode: mvp", 'goal: "g"']))).toContain("done_when");
  });

  test("MODES continua mvp|padrao|completo", () => {
    for (const m of ["mvp", "completo"]) {
      expect(parsePlan(doc([], [`mode: ${m}`, 'goal: "g"', 'done_when: "true"', 'touch: ["a"]'])).ok).toBe(true);
    }
    expect(errors(doc([], ["mode: full", 'goal: "g"', 'done_when: "true"']))).toContain("mode");
  });

  test("limite de 25 linhas continua valendo", () => {
    const longo = doc(["type: task"]) + Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n") + "\n";
    expect(errors(longo)).toContain("25");
  });
});
