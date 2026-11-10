---
mode: mvp
goal: "pinga gate <T...>: sai 0 quando todas as TASKs listadas têm receipt done na fila, senão 12 listando as pendentes; é o gate de merge que o manda chama por [commands].gate"
done_when: "bun test tests/gate_cli.test.ts"
touch:
  - src/cli.ts
  - tests/gate_cli.test.ts
  - tasks/T901/PLAN.md
tests_frozen:
  - tests/gate_cli.test.ts
---

## Contexto
- A regra hoje vive em `manda/src/merge.ts` (saída 12), que lê `pinga queue --json` e decide.
- `pinga gate` reaproveita `scanQueue`; TASK ausente da fila conta como pendente.
- Sem TASK na linha de comando não há o que checar: sai 0.
- Saída: uma linha JSON `{ok, pending}`; flags `--root` e `--ledger` como no `queue`.
