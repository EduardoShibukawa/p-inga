# p-inga

P-Ingá v0.1.0 — contratos de verificação formal para tarefas de agentes.

Cada task é um `PLAN.md` com `cobre`, `touch` e `done_when`; a execução só conta
como pronta quando o `done_when` roda de verdade e o recibo é selado no ledger
append-only.

## Começando

```bash
mise install          # fixa Bun 1.4.4 e hk
bun bin/pinga.ts doctor
```

Nada é coletado por padrão: dados brutos e estado local ficam fora do
versionamento — só entram código, specs, tasks e fixtures sintéticas em
`testdata/`.

## Comandos principais

```bash
bun bin/pinga.ts doctor                      # saúde do toolchain e do ledger
bun bin/pinga.ts ledger verify               # integridade da cadeia de hash
bun bin/pinga.ts verify tasks/T32/PLAN.md    # verifica um contrato de task
bun bin/pinga.ts web                         # painel web em localhost:4242
bun test                                     # suíte completa
```

O painel (`bun bin/pinga.ts web`) lê o mesmo `ledger.db` e mostra recibos,
scoreboard do maestro e o grafo de macros. `PINGA_WEB_PORT` troca a porta e
`--port N` tem precedência sobre a variável.

## Documentação

O detalhe fica em `docs/`:

- `docs/intro.md` — o problema e a arquitetura em uma página
- `docs/guides/quickstart.md` — primeiro task verificado em 3 passos
- `docs/concepts/invariants.md` — as 20 invariantes que o gate aplica
- `docs/concepts/ledger.md` — estrutura do ledger e triggers anti-tamper

## Desenvolvimento

```bash
bun test
```

O hook `pre-commit` roda `mise run pre-commit`, que executa `bun test`.
