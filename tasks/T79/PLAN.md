---
mode: mvp
goal: "A fila do pinga só conta recibo do repo da raiz (ou legado sem repo): pass de T4 em outro repo não fecha a T04"
done_when: "bun test tests/queue_repo_scope.test.ts tests/queue.test.ts tests/queue_state_prove_red.test.ts tests/queue_state_retention.test.ts"
touch:
  - src/queue.ts
  - tests/queue_repo_scope.test.ts
tests_frozen:
  - tests/queue_repo_scope.test.ts
---

## Contexto
- `scanQueue` filtra `rows` antes de casar receipts: descarta linha cujo `body.repo` existe e difere de `repoScope(root)` (`src/breaker.ts`, realpath do git common dir). Linha sem `repo` (legado) fica. Raiz sem git (`repoScope` undefined) = sem filtro.
- Origem: ALERTA do judge do PLAN-0009 (seq 313 "T4"@manda fechava a T04 do gira-g).
- Não fazer: não tocar em verify/ledger/judge; não mudar `normalizeTask`.
