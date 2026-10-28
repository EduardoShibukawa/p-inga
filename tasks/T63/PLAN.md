---
mode: padrao
goal: "Um resolvedor único de id de task cobre tasks/T<N>/PLAN.md e PLAN-*/TASK-*.md em verify e prove-red"
done_when: "bun test tests/task_ref.test.ts tests/verify.test.ts tests/prove.test.ts"
tests_frozen: ["tests/task_ref.test.ts"]
touch: ["src/task_ref.ts", "src/verify.ts", "src/prove.ts", "tests/task_ref.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-02-task-ref.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
