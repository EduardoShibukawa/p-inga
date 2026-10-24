# SPEC 0002 — P-Ingá v0.1 Rodada 3 (Juiz Distinto, Modos de Execução, Examples & Prova no Base)

- status: draft (aprovação do dono pendente)
- data: 2026-10-24
- herda: `specs/0001-p-inga-v0.1.md` (D1–D7, I1–I9, processo §6, gate §8). Nada aqui revoga a 0001; onde houver refinamento, ele é explícito (I1′).
- justificativa: parecer de arquitetura https://claude.ai/artifact/VLi8Q6XHTU9h5rFgHA3Pft#veredito (§5.1 modos, §5.3 promoção, §5.4 envelopes, §5.5 TDD em três camadas, §9.2 backlog, §9.4 regras com o Opus) e `../P-INGA-INSTALL-E-APRENDIZADO.md` (§B.5: juiz de família distinta aborta, não cai em fallback).

## 1. Contexto e veredito

O veredito do parecer é o **Plano B**: o Core e o ledger de recibos no centro, sessões curtas guiadas por contrato, telemetria honesta e recibos de até 4 KB. As rodadas anteriores construíram a base:

| Rodada | Tasks | Entregou |
|---|---|---|
| 1 (SPEC 0001) | T00–T03 | esqueleto, schema do recibo v1, ledger encadeado por hash, `pinga verify` + `pinga-stable` |
| 2 (SPEC 0001 §4) | T04–T07 | cerca do `touch` e `tests_frozen`, disjuntor por assinatura, tokens do host (`host-structured`), `pinga eval` |
| **3 (esta)** | **T08–T11** | **fecha a Fase 1** (T08 juiz de família distinta) e **entrega a Fase 2** (T09 modos, T10 examples + holdout, T11 prova no base) |

O que a rodada 3 ataca, cada item com a evidência do parecer (§1.3):

- **F-0005**: 100% das execuções locais atribuídas ao "ornith 9B", servidas por Qwen3.5-4B. A família do juiz só vale se o modelo for **atestado pelo endpoint**, não pela config → T08.
- **OVERNIGHT-0008 §1-2**: o juiz de outra família achou 5 bugs reais que a spec deixou passar. O anti-self-grading já se pagou → T08.
- **§5.1**: com dois modos, o dia a dia cai num extremo. Três modos, roteados por sinais do diff, sobem sozinhos e só descem por override registrado → T09.
- **§5.5**: "passou no teste" só prova o que o teste checa. O contrato precisa de RED visível congelado (T04, feito), **holdout oculto** (T10) e **prova de que o teste falha no base** (T11). O teste gerado de `examples` custa zero tokens de LLM (T10).

## 2. Decisões fixadas

| # | Decisão | Valor |
|---|---|---|
| D8 | Planejador da rodada 3 | `claude-opus-5-5` (família `claude`). Escreve SPEC, `PLAN.md`, `RED.md` e o commit RED. `PINGA_PLANNER_MODEL=claude-opus-5-5`, `PINGA_PLANNER_FAMILY=claude` no `pinga eval` |
| D9 | Executor (GREEN) da rodada 3 | escolhido pelo dono por task, **família ≠ `claude`** (ex.: opencode `glm-5.3-flash-free`, agy `gemini-3.8-flash`). Quem escreveu o teste não implementa (§9.4, SPEC 0033 do pi-harness) |
| D10 | Juiz | T08 é julgada pelo dono (a task muda o próprio verificador; regra do verificador congelado, §9.1). A partir da T09: `.pinga/pinga-stable judge`, juiz padrão `qwen3.5-4b` no llama-server `127.0.0.1:8089`, atestado por `/v1/models`. **Nenhum Claude julga Claude**, nem Sonnet nem Haiku |
| D11 | Modos | `mvp` < `padrao` < `completo` (ordem total). Tasks T08–T11 continuam `padrao` (D7) |
| D12 | Holdout | oculto **por convenção** (fora da worktree e do git, em `PINGA_HOLDOUT_DIR`, padrão `~/.local/state/pinga/holdout/`), não por permissão do SO. Obrigatoriedade em `completo` fica para depois do A/B do §5.5 (recomendação do dono, §10 item 7) |
| D13 | Base da prova | o commit RED da task (`findRedBase`, T04), ou `--base`. No commit RED a árvore é "código antigo + teste novo"; é ali que o teste tem de falhar |
| D14 | Dependências | continua D4: zero npm. `fetch`, `Bun.serve` (só nos testes), `Bun.Glob`, `Bun.YAML`, `git worktree` |

## 3. Invariantes novos e refinados

- **I1′** (refina I1): `pass` exige `done_when` com exit 0. O juiz e o holdout **só podem rebaixar** (`pass` → `fail`), nunca promover. Nenhum LLM decide um `pass`.
- **I10** (anti-self-grading): `modelFamily(served do juiz) ≠ família do executor`. Igual → `blocked`/`same_family_judge`, **sem** chamar o modelo. Família do executor desconhecida → `blocked`/`model_unattested` (fail-closed; não há fallback para "o primeiro elegível", ao contrário do router do pi-harness).
- **I11** (telemetria honesta): o recibo do juiz grava `model_attested: { claimed, served, via }`. A família vem de `served`, nunca de `claimed`. Endpoint fora → `not run`/`infra`, nunca `pass`.
- **I12** (modo monotônico): `mode_effective = max(mode do plano, sinais)`. Só desce com `--override-mode <m> --reason <texto>`, registrado em `mode_override` no recibo. Todo recibo do verify com plano válido carrega `mode_effective` e `mode_raised_by`.
- **I13** (teste sem LLM): o teste gerado de `examples` é função pura dos exemplos (bytes idênticos para a mesma entrada). A partição visível/holdout é determinística (sha256), não escolhida por quem escreve.
- **I14** (holdout cego): o holdout nunca entra na worktree, no git, nem no recibo; o operário só recebe `pass`/`fail` e a contagem. Visíveis passam e holdout falha → `fail`/`overfit_holdout`.
- **I15** (RED não vazio): o `done_when` (e o holdout, se houver) tem de **falhar** numa worktree limpa no base. Passou no base → `blocked`/`test_passed_on_base`. A worktree temporária é sempre removida, inclusive em erro.

## 4. Contratos compartilhados

### 4.1 Recibo v1 — extensões (todas opcionais, sub-objetos rejeitam chave desconhecida)

| Campo | Task | Tipo |
|---|---|---|
| `model_attested` | T08 | `{ claimed: string \| null, served: string, via: "/v1/models" \| "transcript" }` |
| `mode_effective` | T09 (já existia como string) | passa a ser enum `mvp \| padrao \| completo` |
| `mode_raised_by` | T09 | enum `MODE_RAISED_BY` (T09/RED.md) |
| `mode_override` | T09 | `{ from: Mode, to: Mode, reason: string (1..280) }` |
| `base_ref` | T11 | 40 hex |

`REASON_CODES` ganha, **no fim da lista e nesta ordem**: `judge_rejected`, `model_unattested` (T08), `overfit_holdout` (T10), `test_passed_on_base` (T11). O commit RED de cada uma dessas tasks atualiza a expectativa de `REASON_CODES` em `tests/receipt.test.ts`; como a guarda da T04 mede a partir do commit RED, isso não é `tests_frozen_changed`.

### 4.2 Tipos de recibo (`receiptKind`)

| `flow` | kind | Quem grava | Conta em `attempts`/`status` do `eval` e no disjuntor? |
|---|---|---|---|
| ausente ou outro | `verify` | `pinga verify` | sim |
| `"judge"` | `judge` | `pinga judge` (T08) | não; vira o `parecer` do EVAL |
| `"prove_red"` | `prove_red` | `pinga prove-red` (T11) | não |

`awaiting_judge` (T09) é um recibo `verify`. `lastReceiptFor` (T05) e `evalPlan` (T07) passam a filtrar por `receiptKind === "verify"`.

### 4.3 Exit codes do `pinga`

| Exit | Significado | Desde |
|---|---|---|
| 0 | pass | T03 |
| 1 | fail (`command_failed`, `judge_rejected`) | T03, T08 |
| 2 | uso inválido ou timeout (`budget`) | T03 |
| 3 | `plan_invalid` | T03 |
| 4 | disjuntor | T05 |
| 5 / 6 | `tests_frozen_changed` / `scope_drift` | T04 |
| **7** | `same_family_judge` | T08 |
| **8** | `infra` ou `model_unattested` (juiz, atestado, prova inconclusiva) | T08, T11 |
| **9** | `overfit_holdout` | T10 |
| **10** | `test_passed_on_base` | T11 |

### 4.4 O que cada modo exige ao fim da rodada 3

| Modo | `done_when` | RED + `tests_frozen` | holdout | prova no base | juiz |
|---|---|---|---|---|---|
| `mvp` | obrigatório | recomendado | roda se existir | manual (`pinga prove-red`) | — |
| `padrao` | obrigatório | obrigatório (T04) | roda se existir | `pinga prove-red` no gate do RED (processo §6) | `pinga judge` no fim (processo §6) |
| `completo` | obrigatório | obrigatório | roda se existir (D12) | **automática no `verify`** (T11) | **obrigatório**: `pass` sai com `flow: "awaiting_judge"` e `next_action: "pinga judge"` (T09) |

## 5. Escopo da rodada 3

| Task | Entrega | Contrato |
|---|---|---|
| T08 | `modelFamily`, atestado por `/v1/models` e por transcript, `pinga judge`, `receiptKind`, `parecer` do EVAL vindo do juiz | `tasks/T08/` |
| T09 | roteador de modo por sinais (`touch` ∪ diff, trunk, noite), `pinga mode`, `mode_*` em todo recibo do verify | `tasks/T09/` |
| T10 | `pinga examples`: partição determinística, teste parametrizado gerado sem LLM, holdout fora da worktree avaliado no verify | `tasks/T10/` |
| T11 | `pinga prove-red` e prova automática em `completo`: `git worktree` temporária no base, limpeza garantida | `tasks/T11/` |

Ordem obrigatória T08 → T09 → T10 → T11 (cada uma usa a anterior: T09+ julgadas pela T08; T11 roda o holdout da T10 no base).

## 6. Critérios de aceite

| AC | Critério | Verificação |
|---|---|---|
| AC-08 | juiz conforme `tasks/T08/RED.md` | `bun test tests/judge.test.ts` |
| AC-09 | roteador conforme `tasks/T09/RED.md` | `bun test tests/mode.test.ts` |
| AC-10 | examples e holdout conforme `tasks/T10/RED.md` | `bun test tests/examples.test.ts` |
| AC-11 | prova no base conforme `tasks/T11/RED.md` | `bun test tests/prove.test.ts` |
| AC-S | suíte inteira verde depois de cada GREEN | `bun test` (pre-commit) |
| AC-J | T09–T11 têm recibo `judge` com `verified_by.family ≠ author.family` e `model_attested.via = "/v1/models"` | `pinga ledger verify` + leitura do ledger |
| AC-P | provas retroativas: depois do GREEN da T11 e de `mise run stable`, `.pinga/pinga-stable prove-red tasks/TNN/PLAN.md` dá exit 0 para N = 08..11 (a base é o commit RED de cada uma, que continua no git) | recibo `prove_red` no ledger, `pinga ledger verify` ok |
| AC-E | `tasks/TNN/EVAL.md` gerado por `pinga eval` e `--check` exit 0 | `.pinga/pinga-stable eval tasks/TNN/PLAN.md --check` |

## 7. Processo por task (atualiza SPEC 0001 §6)

1. Commit RED (`test(TNN): RED …`): só testes. A partir da T12, `.pinga/pinga-stable prove-red tasks/TNN/PLAN.md` tem de dar exit 0 antes do gate.
2. **Gate:** o dono (ou revisor não-`claude`, D9) revisa o RED.
3. Commit GREEN (`feat(TNN): …`): só `touch`, caminhos explícitos, nunca `--no-verify`.
4. `.pinga/pinga-stable verify tasks/TNN/PLAN.md` (com `PINGA_USAGE_FILE` do transcript do executor).
5. A partir da T09: `.pinga/pinga-stable judge tasks/TNN/PLAN.md` (juiz ≠ família do executor).
6. `.pinga/pinga-stable eval tasks/TNN/PLAN.md` gera o `EVAL.md`; o dono escreve as 3 linhas.
7. `mise run stable` depois do commit `docs(TNN): EVAL e EXEC`.

## 8. Ponte para a rodada 4

A rodada 3 deixa prontas as três peças de que a rodada 4 depende:

| Rodada 4 | Depende de | Por quê |
|---|---|---|
| **Fase 3 · T12** `pinga install --dry-run` (HOME-sombra, manifest, adaptador Claude Code) | T11 | a primeira task que muda config real tem RED provado no base (nenhum teste vazio no instalador, §7 do parecer: T1–T3 em `HOME=$(mktemp -d)`) |
| **Fase 3 · T13** adaptadores pi, opencode, Hermes, TUIOS + `pinga doctor` (4 valores) | T08, T09 | o doctor reusa `attestFromEndpoint` como health probe do llama-server; tasks que tocam `.github/**`/lockfile caem em `completo` (T09) e exigem juiz |
| **Fase 4 · T14** `learn.db` (índice, redação, fixture de token falso) | T08, T06 | `model_family` de cada sessão vem de `modelFamily` (T08); tokens `null` nunca `0` (T06) |
| **Fase 4 · T15** detectores + `LESSONS-PROPOSED.md` | T08, T10 | validação de lição por juiz de outra família que **aborta** (I10); os EVAL.md com parecer do juiz são a fonte estruturada; o replay no bench usa o mesmo par visível/holdout |

Gate de saída da v0.1 (SPEC 0001 §8) continua: 20 tasks com recibo `pass` e tokens `host-structured`. T07–T11 contam (5); a rodada 4 entrega mais 4; o resto vem de tasks reais (petclinic, pi-harness).

## 9. Fora de escopo

- Promoção `mvp` → `completo` (§5.3 do parecer): os blocos existem (prova no base, juiz), mas o fluxo de promoção e a spec BDD ficam para a v0.2.
- Teste de mutação (mutmut/Stryker/PIT), caracterização (golden master), teste de propriedade.
- Calibração do juiz com bugs plantados; seleção automática do juiz por pool/cota (o juiz é um só, escolhido por flag/env).
- Holdout protegido por permissão do SO; holdout obrigatório em `completo` (D12).
- Hooks do TUIOS, Hermes, `pinga install/doctor` (rodada 4).

## 10. Riscos e decisões pendentes do dono

- **Juiz pequeno (qwen3.5-4b) como parecerista**: pode aprovar demais. Mitigação: I1′ (o juiz só rebaixa) e a calibração com bugs plantados na v0.2.
- **Holdout lido pelo operário com shell**: D12 assume convenção. Se o A/B mostrar ganho, a v0.2 move o holdout para outro usuário/sandbox.
- **Prova no base em repos com dependências** (ex.: `node_modules`, `.m2`): a worktree limpa não tem artefatos de build; exit 126/127 vira `infra`, não prova. O p-inga (zero deps) não é afetado.
- **Sinais de modo por glob**: falsos positivos (`docs/api/README.md` → `completo`). Aceito: errar para cima é barato; descer exige override com motivo.
