---
mode: padrao
goal: "pinga queue --json lista as TASK-*.md de PLANs approved com o status vindo do ledger e respeitando depends_on"
done_when: "bun test tests/queue_bundle.test.ts tests/queue.test.ts"
tests_frozen: ["tests/queue_bundle.test.ts"]
touch: ["src/queue.ts", "tests/queue_bundle.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-06-queue-bundle.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
