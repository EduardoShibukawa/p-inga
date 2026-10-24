---
mode: padrao
goal: "Schema do recibo v1 com validador sem dependências: 4 status, reason_code fechado, teto de 4 KB, campo desconhecido é erro e token ausente é null."
done_when: "bun test tests/receipt.test.ts"
touch: ["src/receipt.ts"]
tests_frozen: ["tests/receipt.test.ts"]
budget: { tokens: 200000, minutes: 45 }
---
## Passos
- [ ] commit RED: tests/receipt.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: src/receipt.ts com a API de RED.md
- [ ] commit GREEN; preencher EVAL.md

## Dívidas conscientes
- campos de §5.4 do parecer que a v0.1 não usa ficam opcionais
- sem JSON Schema publicado: o validador em TS é a fonte

## Fora
- nada de ledger, CLI ou I/O de arquivo
- nenhuma biblioteca de validação (zod etc.)
