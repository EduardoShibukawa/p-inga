---
mode: mvp
goal: "parsePlan aceita e valida os campos opcionais da TASK nova e recusa type: plan com erro claro"
done_when: "bun test tests/task_schema.test.ts tests/repo.test.ts"
tests_frozen: ["tests/task_schema.test.ts"]
touch: ["src/plan.ts", "tests/task_schema.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-01-schema-task.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
