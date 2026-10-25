---
mode: padrao
goal: "Plano A (Maestro Hermes): envelope estrito <=4096 bytes (MAX_ENVELOPE_BYTES), placar adaptativo de operários (FTPR, tokens medianos da Lei 1), recomendação de orquestração motor vs maestro e CLI pinga maestro."
done_when: "bun test tests/maestro.test.ts"
touch: ["src/maestro.ts", "src/cli.ts"]
tests_frozen: ["tests/maestro.test.ts", "tests/audit.test.ts", "tests/lessons.test.ts"]
budget: { tokens: 400000, minutes: 120 }
id: T20
title: "Plano A — Modo Maestro com Hermes e placar adaptativo de orquestração"
spec: specs/0005-p-inga-v0.3-plano-a-maestro.md
phase: 6
verify: "bun test tests/maestro.test.ts"
max_attempts: 3
risk_flags: []
holdout_rule: "sha256 partition >= 4 visible + 2 holdout"
examples_cmd: "pinga examples tasks/T20-maestro-hermes/PLAN.md --from testdata/examples/T20.yaml"
---
## Passos
- [ ] RED: tests/maestro.test.ts; prove-red exit 0; GREEN: maestro/cli; eval
## Exemplos (gerados antes do código)
1. in: { bytes: 5000 } -> truncated <= 4096; 2. in: { ftpr: 0.8 } -> ranked
3. in: { mode: "mvp" } -> motor; 4. in: { mode: "completo" } -> maestro
5. in: { tasks: 1 } -> unranked; 6. in: { ftpr: 0.9, tokens: 100k } -> recommended
## Dívidas conscientes / Fora
- stub hermes configurável; orquestração multi-máquina fora; v0.4
