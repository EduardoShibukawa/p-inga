---
mode: padrao
goal: "supersede, mode, examples, maestro e os sidecars usam taskRef; o legado continua em tasks/T<N>/"
done_when: "bun test tests/task_ref_sidecar.test.ts tests/guards.test.ts tests/queue.test.ts tests/maestro.test.ts tests/mode.test.ts"
tests_frozen: ["tests/task_ref_sidecar.test.ts"]
touch: ["src/task_ref.ts", "src/supersede.ts", "src/mode.ts", "src/examples.ts", "src/maestro.ts", "src/guards.ts", "src/queue.ts", "src/verify.ts", "src/cli.ts", "tests/task_ref_sidecar.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-03-task-ref-resto.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
