---
mode: padrao
goal: "verify, prove-red e judge aceitam --root <repo>: git root e cwd do done_when vêm do repo indicado"
done_when: "bun test tests/root_flag.test.ts tests/verify.test.ts"
tests_frozen: ["tests/root_flag.test.ts"]
touch: ["src/cli.ts", "src/verify.ts", "src/prove.ts", "src/judge.ts", "tests/root_flag.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-04-root-flag.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
