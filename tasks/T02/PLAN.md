---
mode: padrao
goal: "Ledger append-only em bun:sqlite com cada recibo encadeado pelo hash do anterior, e o comando pinga ledger verify."
done_when: "bun test tests/ledger.test.ts"
touch: ["src/canonical.ts", "src/ledger.ts", "src/cli.ts", "bin/pinga.ts", "package.json"]
tests_frozen: ["tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 250000, minutes: 60 }
---
## Passos
- [ ] commit RED: tests/ledger.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: canonical, ledger, cli mínima com só `ledger verify`
- [ ] package.json ganha `bin: { pinga: "bin/pinga.ts" }`
- [ ] commit GREEN; preencher EVAL.md

## Dívidas conscientes
- sem migração de schema: a tabela é v1 fixa
- sem lock entre processos além do do SQLite

## Fora
- não implementar `verify` (é a T03)
- não mexer em src/receipt.ts
