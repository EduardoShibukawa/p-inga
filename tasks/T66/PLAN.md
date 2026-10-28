---
mode: padrao
goal: "pinga verify em um PLAN.md (type: plan) exige pass em todas as TASKs da pasta e então roda o done_when do PLAN"
done_when: "bun test tests/plan_verify.test.ts"
tests_frozen: ["tests/plan_verify.test.ts"]
touch: ["src/plan_verify.ts", "src/cli.ts", "src/receipt.ts", "tests/plan_verify.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-05-plan-verify.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
