---
mode: mvp
goal: "Ledger global volta a verificar: main reconhece reason codes gravados pela fila"
touch:
  - src/receipt.ts
done_when: "bun test tests/receipt.test.ts && bun bin/pinga.ts ledger verify"
tests_frozen: ["tests/receipt.test.ts"]
---
# T40: reason codes da fila no main

`pinga ledger verify` quebra no seq 65: a cadeia de hashes está íntegra, mas
recibos da worktree p-inga-queue usam `superseded` e `delta_no_touch`, ausentes
de REASON_CODES no main. Adiciona os dois códigos (mesmo diff da fila).
