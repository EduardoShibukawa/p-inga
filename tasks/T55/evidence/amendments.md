# T55 — emendas ao validador congelado

## 2026-10-27 · sonda `--version` → `tdd list`

**O que estava errado.** O validador congelado usava `runPinga(["--version"], …)`
e exigia `exit 0` + `stdout` casando `/^\d+\.\d+\.\d+/`. A CLI **não tem**
`--version`: ela responde `pinga: comando desconhecido: "--version"` com **exit 2**.
O RED original (5 fail / 2 pass) então media duas coisas ao mesmo tempo — a
exceção `Executable not found in $PATH` (o defeito real) e um comando inexistente
(erro do validador). Com o `PATH` injetado, sobrava exit 2 e a task continuaria
vermelha por motivo alheio ao contrato.

**Critério preservado.** O contrato é "o filho recebe `PATH` e por isso executa";
não muda nada sobre qual comando. A sonda passou a ser `pinga tdd list` — o
comando real mais barato e determinístico (exit 0, ~40 ms, sem escrita em disco).

**Asserções novas.** `exit == 0`, `stdout` não vazio, `stderr` vazio; segundo
caso mantém `PATH` explícito do chamador e exige exit 0; terceiro caso continua
checando que `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`PI_CODING_AGENT_DIR` são removidos.

**Não muda.** `touch: [tests/helpers/home.ts]` e `done_when` seguem iguais.
