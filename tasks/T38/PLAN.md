---
mode: padrao
goal: "Sincronizar o spec congelado do recibo (tests/receipt.test.ts) com o vocabulário real de REASON_CODES, depois que a T37 acrescentou delta_no_touch e superseded ao schema."
done_when: "bun test tests/receipt.test.ts && bun test tests/guards.test.ts"
touch: ["tests/receipt.test.ts", "tasks/T38/PLAN.md"]
---
## Passos
- [ ] RED: `bun test tests/receipt.test.ts` falha em "constants STATUSES, REASON_CODES, MAX_RECEIPT_BYTES, MAX_TEXT are exported" — a lista esperada tem 13 códigos e REASON_CODES tem 15
- [ ] GREEN: acrescentar `delta_no_touch` e `superseded` à lista esperada (espelho 1:1 de REASON_CODES, sem afrouxar o validador)
- [ ] GREEN: `bun test tests/receipt.test.ts` verde e contrato congelado de GUARD_EXIT (5 e 6) intacto em `tests/guards.test.ts`

## Justificativa
A T37 estendeu o vocabulário em `src/receipt.ts` e a lista do spec ficou defasada; a T01 ficou bloqueada com
`tests_frozen_changed` por causa disso. Esta fatia é manutenção do espelho, não enfraquecimento: o validador
continua fechado (campo/reason desconhecido é erro), `STATUSES` não muda e nenhum teste de comportamento é tocado.
O guard de teste congelado não pode ser a auto-isenção de quem implementa a mudança — por isso a alteração do
spec entra como task própria (T38), com recibo e artefato, e só depois a T01 é reverificada contra o spec novo.
