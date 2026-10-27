---
mode: mvp
goal: "runPinga propaga PATH ao processo filho: env mínimo (HOME/XDG_STATE_HOME/TMPDIR) não estoura Executable not found, e PATH explícito do chamador é respeitado"
touch:
  - tests/helpers/home.ts
done_when: "bun test tests/ux_t55_helper_path.test.ts"
tests_frozen: ["tests/ux_t55_helper_path.test.ts"]
---
# T55: helper de teste herda PATH

`runPinga` (tests/helpers/home.ts:175) passa ao `Bun.spawnSync` um `childEnv` derivado do
env recebido, sem `PATH`. Com env mínimo o filho morre em
`error: Executable not found in $PATH: "bun"` — não vira exit code, vira exceção no teste.
A suíte esconde o defeito porque `makeRealisticHome` injeta PATH (home.ts:119).
Defeito pré-existente em main (0899228 e 0825bf5), não regressão do ciclo UX.
