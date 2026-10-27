# Emendas de teste congelado — 2026-10-26

Duas cláusulas de ciclo de vida foram relaxadas em testes congelados da fase de análise.
Registro aqui porque `tests_frozen` é contrato: alteração não pode ser silenciosa.

## 1. `tests/ux_t35_validate.test.ts:39` (p-inga, T35)

Antes: `expect(spec).toMatch(/^Status: draft$/m)`
Depois: `expect(spec).toMatch(/^Status: (draft|approved)$/m)`

Motivo: o T36 tem por contrato promover `draft -> approved`. Um validador congelado exigindo
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
