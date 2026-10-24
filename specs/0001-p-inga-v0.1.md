# SPEC 0001 — P-Ingá v0.1 (Plano B: Motor e ledger primeiro)

- status: draft (aprovação do dono pendente)
- data: 2026-10-24
- justificativa: parecer de arquitetura https://claude.ai/artifact/VLi8Q6XHTU9h5rFgHA3Pft e `../P-INGA-INSTALL-E-APRENDIZADO.md`. Esta spec não repete o parecer; só fixa o que ele deixou em aberto para a v0.1.

## 1. Objetivo

Construir o Core do P-Ingá de forma que ele seja usado no próprio desenvolvimento desde cedo. A partir da T03, toda task é fechada pelo `pinga verify`. A partir da T06, toda task tem tokens medidos (Lei 1). A partir da T07, toda task termina com avaliação.

## 2. Decisões fixadas

| # | Decisão | Valor |
|---|---|---|
| D1 | Plano no centro | **B** (Core + ledger). C entra como substrato na v0.2, A por cima na v0.3 |
| D2 | Repo | `duh-homelab/p-inga/`, branch `main`, remote GitHub **privado** `EduardoShibukawa/p-inga`, sem CI. O dono cria o remote |
| D3 | Stack | Bun/TS, Bun `1.4.4` fixado no `mise.toml`, pre-commit com `hk` + `mise run pre-commit` (como o pi-harness) |
| D4 | Dependências | **zero dependências de runtime** na v0.1: só built-ins do Bun (`bun:sqlite`, `Bun.YAML`, `Bun.spawn`, `node:crypto`) |
| D5 | Planejador (RED) e Executor (GREEN) da rodada 1 | Planejador: agy + Gemini 4 Argon (família `gemini`). Executor: escolhido pelo dono por task (agy Gemini 3.8 Flash ou opencode de outra família) |
| D6 | Revisor do RED e juiz da rodada 1 | O dono revisa o RED. Conferência mecânica pelo Planejador; parecer de qualidade pelo Planejador só se o Executor for de outra família (`≠ gemini`), senão pelo dono. A partir da T08, juiz automático de família distinta |
| D7 | Modo das tasks T00–T15 | `padrao`: `PLAN.md` ≤ 25 linhas + teste RED commitado antes |

## 3. Invariantes

- **I1** (Lei 1): o status de uma task vem só do exit code do `done_when`, gravado no ledger. Nenhuma autodeclaração.
- **I2** (Lei 2): status ∈ `pass` · `fail` · `blocked` · `not run`. Nada mais.
- **I3** (Lei 3): duas falhas seguidas com a mesma saída e sem fato novo → parar e escalar ao dono. Manual até a T05; automático depois.
- **I4**: tokens ausentes são `null`, nunca `0`.
- **I5**: o commit GREEN não altera nenhum arquivo de `tests_frozen`. Manual até a T04; automático depois.
- **I6**: a partir da T03, tasks são fechadas por `.pinga/pinga-stable`, construído do último commit aceito, nunca pela working tree.
- **I7**: nada de dados brutos, `*.db` ou segredos no git. O `.gitignore` é testado (T00).
- **I8**: nunca `git add .`/`-A`; sempre caminhos explícitos. Nunca `--no-verify`.
- **I9**: recibos não carregam log bruto; só `artifact_ref` (caminho + sha256) e teto de 4 KB.

## 4. Escopo da v0.1

| Task | Entrega | PLAN nesta rodada |
|---|---|---|
| T00 | esqueleto do repo | `tasks/T00/` |
| T01 | schema do recibo v1 | `tasks/T01/` |
| T02 | ledger append-only encadeado por hash | `tasks/T02/` |
| T03 | `pinga verify` + `pinga-stable` | `tasks/T03/` |
| T04–T15 | guardas, tokens, eval, juiz, modos, examples, prova no base, `pinga install/doctor`, aprendizado | PLANs escritos depois da avaliação de T00–T03 |

## 5. Critérios de aceite da rodada 1

| AC | Critério | Verificação |
|---|---|---|
| AC-00 | esqueleto conforme `tasks/T00/RED.md` | `bun test tests/repo.test.ts` |
| AC-01 | validador de recibo conforme `tasks/T01/RED.md` | `bun test tests/receipt.test.ts` |
| AC-02 | ledger conforme `tasks/T02/RED.md` | `bun test tests/ledger.test.ts` |
| AC-03 | `pinga verify` e `stable` conforme `tasks/T03/RED.md` | `bun test tests/verify.test.ts` |
| AC-R | recibos retroativos: `.pinga/pinga-stable verify tasks/T0N/PLAN.md` dá `pass` para N = 0..3 e `pinga ledger verify` dá `ok 4` | com `PINGA_LEDGER=p-inga/.pinga/ledger.db`; na rodada 1, nada é gravado fora do repo |
| AC-E | cada task tem `tasks/T0N/EVAL.md` preenchido (template §6) | leitura pelo dono |

## 6. Processo por task

1. Commit RED: só o arquivo de teste, com os casos do `RED.md`. O teste tem de falhar.
2. **Gate:** o dono (ou um revisor de outra família) revisa o teste. Sem aprovação, não há GREEN.
3. Commit GREEN: só arquivos do `touch`. `git diff RED..GREEN -- <tests_frozen>` vazio.
4. Verificação: `done_when` passa. A partir da T03, `.pinga/pinga-stable verify tasks/TNN/PLAN.md`.
5. `EVAL.md` (manual até a T07):

```markdown
## EVAL TNN
executor: <modelo> (<família>) · planejador: gemini-4-argon (gemini)
auto:   status <pass|fail|blocked|not run> · tentativas N · tempo N min · tokens not run
escopo: tests_frozen <intacto|ALTERADO> · fora do touch: <nenhum|lista>
parecer: <1 linha, só se o executor for de outra família; senão "n/a: mesma família">
dono:
  bom:   <1 linha>
  ruim:  <1 linha>
  mudar: <1 linha ou "nada"> → vira entrada no backlog, nunca muda a task atual
```

## 7. Fora de escopo

Hermes como Maestro, hooks do TUIOS, adaptadores de harness além do Claude, pipeline de aprendizado (todos têm task própria depois da T03), CI, publicação de release.

## 8. Gate de saída da v0.1

20 tasks reais com recibo `pass` no ledger e tokens medidos (`source: host-structured`).
