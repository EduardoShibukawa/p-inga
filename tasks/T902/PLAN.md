---
mode: padrao
goal: "a fila do bundle fecha a TASK que tem pinga_task: T<N> quando há receipt pass de T<N> no repo dela; sem isso a TASK materializada pelo manda red nunca vira done"
done_when: "bun test tests/queue_pinga_task.test.ts tests/queue_bundle.test.ts tests/queue.test.ts tests/queue_repo_scope.test.ts"
touch:
  - src/queue.ts
  - tests/queue_pinga_task.test.ts
  - tasks/T902/PLAN.md
tests_frozen:
  - tests/queue_pinga_task.test.ts
---

## Contexto
- `manda red` materializa `TASK-NN` como `tasks/T<N>/PLAN.md` no repo e anota `pinga_task: T<N>`.
- O `pinga verify` sela o receipt em `T<N>`; a fila do bundle só procurava `PLAN-NNNN/TASK-NN`.
- Resultado: o `ginga tick` via a TASK sempre `open` e rodava de novo sem parar.
- Escopo: o receipt de `T<N>` só vale se for do git do `repo:` da TASK (ou da raiz).
- Receipt direto na ref do bundle continua tendo precedência; `prove_red` não fecha.
- `depends_on` também passa a enxergar o alias.
