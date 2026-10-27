# Emendas de teste congelado — 2026-10-26

Duas cláusulas de ciclo de vida foram relaxadas em testes congelados da fase de análise.
Registro aqui porque `tests_frozen` é contrato: alteração não pode ser silenciosa.

## 1. `tests/ux_t49_validate.test.ts:39` (p-inga, T49)

Antes: `expect(spec).toMatch(/^Status: draft$/m)`
Depois: `expect(spec).toMatch(/^Status: (draft|approved)$/m)`

Motivo: o T50 tem por contrato promover `draft -> approved`. Um validador congelado exigindo
`draft` proíbe a transição que a task seguinte deve executar — colisão de contrato, não
frouxidão. Checagens substantivas mantidas: ≥6 âncoras `arquivo:linha` válidas, cobertura de
`web/`, `tuios`, `docs/`, critério de aceite por achado, Discord declarado fora de escopo,
corpo da spec ≤60 linhas.

## 2. `internal/docsite/ux_spec_test.go:19` (gira-g, `TestUXSpec`)

Antes: `(?m)^Status: draft$`
Depois: `(?m)^Status: (draft|approved)$`

Mesmo motivo, mesmo procedimento. Mantidos: `ausente: <arquivo>`, ≥6 achados ancorados,
existência do arquivo citado, linha dentro do total do arquivo, cobertura de `cmd/gira` e
`internal/docsite`, critério de aceite presente.

## O que isso NÃO invalida

Os recibos de análise (`badecacb`, `50d0b7e8`, `fe83ee5f`, `ba923dfa`) foram emitidos antes
desta emenda e atestam o RED que existia então (spec ausente / `Status: draft`). Nenhum é
reemitido nem reapresentado. A emenda reduz *somente* o token de estado; nenhuma asserção de
conteúdo foi removida ou enfraquecida.

## Emenda 2026-10-27 · renumeração por colisão de IDs

O merge de `main` (0825bf5) revelou que a fila já ocupava `T35..T38` (queue, guards,
supersede, install rebaseline) e `T40..T48`. Este ciclo UX usava os mesmos IDs.
Renumerado: `T35→T49`, `T36→T50`, `T37→T51`, `T38→T52`, `T39→T53`; validadores
`ux_t35_*→ux_t49_*` … `ux_t39_*→ux_t53_*` e referências em spec/PLAN/evidências.

Consequência no validador congelado: `execPlans()` casava `/^T(3[7-9]|4\d)$/` — passou a
casar as tasks da fila (sem `cobre:`), quebrando duas asserções. Escopo corrigido para
`/^T5[1-3]$/` (as três tasks de execução deste ciclo). Sem mudança de critério.
