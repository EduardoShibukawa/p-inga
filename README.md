# p-inga

Esqueleto do `p-inga`: Core + Ledger v0.1.

Coleta dados brutos em `raw/`, mantém estado local em `state/` e o histórico de
execuções em `runs/`. Nada disso é versionado — apenas código, specs, tasks e
fixtures sintéticas (`testdata/`).

## Desenvolvimento

Ferramentas fixadas via `mise` (Bun 1.4.4, hk 1.24.0):

```bash
mise install
bun test
```

O hook `pre-commit` roda `mise run pre-commit`, que executa `bun test`.
