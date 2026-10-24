# SPEC 0003 — P-Ingá v0.1 Rodada 4 (Distribuição, Doctor, Learn.db & Lições Propostas)

- status: draft (aprovação do dono pendente)
- data: 2026-10-24
- herda: `specs/0001-p-inga-v0.1.md` (D1–D7, I1–I9, gate §8) e `specs/0002-p-inga-v0.1-rodada-3.md` (D8–D14, I1′, I10–I15, contratos §4, processo §7). Nada aqui revoga as anteriores; onde há refinamento, ele é explícito (D15 refina a decisão A1 do design).
- justificativa: parecer https://claude.ai/artifact/VLi8Q6XHTU9h5rFgHA3Pft (§7 instalador, §8 aprendizado, §9.2 T12–T15, §9.4 regras com o Opus) e `../P-INGA-INSTALL-E-APRENDIZADO.md` (Parte A: §A.1–§A.5, decisões A1–A6, aceite T1–T6; Parte B: §B.1–§B.7).

## 1. Contexto

| Rodada | Tasks | Entregou |
|---|---|---|
| 1 (SPEC 0001) | T00–T03 | esqueleto, recibo v1, ledger encadeado, `pinga verify` + `pinga-stable` |
| 2 (SPEC 0001 §4) | T04–T07 | cerca do `touch`/`tests_frozen`, disjuntor, tokens `host-structured`, `pinga eval` |
| 3 (SPEC 0002) | T08–T11 | juiz de família distinta, modos, examples + holdout, prova no base |
| **4 (esta)** | **T12–T15** | **Fase 3** (T12 `pinga install` + Claude Code; T13 adaptadores pi/opencode/Hermes/TUIOS + `pinga doctor`) e **Fase 4** (T14 `learn.db` + redação; T15 detectores + `LESSONS-PROPOSED.md`). Fecha o escopo da v0.1 |

O que a rodada 4 ataca, com a evidência do design:

- **§A.2 / §B.5**: quatro mecanismos de instalação para um pacote, e drift real (3 entradas `local` mortas do `pi-harness` no Claude; `plugins` × `plugin` no OpenCode). O instalador precisa de posse registrada e recusa explícita → T12, T13.
- **§A.5**: o `doctor` do design só vale se `pass` exigir comando registrado. "Nunca zero inventado" vira "nunca `ok` inventado" → T13.
- **§B.2**: o índice só pode existir se nenhum segredo for gravado; a fixture de token falso é o teste de barramento → T14.
- **§8 do parecer**: um detector ingênuo de "correção do usuário" acertou ~1 em 10. Lição só sai de **regra sobre métrica**, nunca de resumo livre, e o juiz que valida **aborta** em vez de cair em fallback → T15.

## 2. Decisões fixadas

| # | Decisão | Valor |
|---|---|---|
| D15 | Isolamento por HOME-sombra | Todo `install`/`revert` monta uma sombra em `mkdtemp(join(realpath(tmpdir()), "pinga-shadow-"))` com cópia **só** dos alvos dos adaptadores. Adaptadores (CLI nativo ou escritor próprio) escrevem **só** na sombra, com `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME` e `PI_CODING_AGENT_DIR` apontando para dentro dela. O HOME real só recebe **bytes copiados da sombra** (escrita atômica: arquivo temporário no mesmo diretório + `rename`), depois de backup por sha256 e de um `--dry-run` cujo diff tem o mesmo sha256. A sombra é removida sempre, inclusive em erro. **Refina A1**: o CLI nativo nunca roda no HOME real (a hipótese "o CLI respeita `HOME`" de §A.5 só precisa valer na sombra; se não valer, o diff mostra arquivos fora dos alvos e o install recusa) |
| D16 | Adaptadores modulares | Um módulo por harness em `src/adapters/<harness>.ts`, todos com a mesma interface (`targets`, `owned`, `apply`, `volatile`, `probe`). Ordem fixa `pi → claude → opencode → hermes → tuios` numa única sombra encadeada (o TUIOS escreve dentro das configs dos outros, §A.4). Claude Code e OpenCode usam escritor próprio restrito às entradas do `pinga` (formatos verificados em §A.2; o `opencode.json` nunca é tocado, decisão 6 do design); pi, Hermes e TUIOS orquestram o CLI nativo (`pi-harness global install`, `hermes plugins install/enable`, `tuios integration install`). Fora da v0.1: agy |
| D17 | `pinga doctor` com 4 estados honestos | `ok \| degraded \| broken \| unverified`. `ok` exige registro `{cmd, exit: 0, stdout_sha256 ≠ sha256(""), duration_ms}`; qualquer outra coisa é rebaixada. Mapeamento para a Lei 2 (I2) no campo `law2`: `ok → pass`, `degraded → fail`, `broken → fail`, `unverified → blocked` (binário ou pré-requisito ausente) ou `not run` (filtrado por `--only`, timeout). O health probe do LLM reusa `attestFromEndpoint` (T08) |
| D18 | `learn.db` separado | SQLite via `bun:sqlite` em `${XDG_STATE_HOME:-~/.local/state}/pinga/learn.db` (ou `PINGA_LEARN_DB`/`--db`), **nunca** o `ledger.db` (o ledger é append-only e encadeado; o índice é reprocessável). Uma linha por sessão/recibo/EVAL, só metadados e trechos redigidos. Recusa caminho dentro de work tree git não ignorado (I7). Fontes da v0.1: recibos do ledger, `tasks/*/EVAL.md` e transcripts JSONL do Claude Code. pi, opencode.db e Hermes `state.db` ficam para a v0.2 |
| D19 | Redação de segredos | Scanner próprio (zero deps, D4; decisão 9 do design: sem `gitleaks`) em três camadas, nesta ordem: (1) regex de formatos conhecidos; (2) lista de negação por hash (`--denylist`/`PINGA_SECRET_DENYLIST`: arquivo de `sha256` hex, um por linha; o `pinga` nunca lê arquivos de credenciais, só hashes que o dono gera); (3) entropia de Shannon ≥ 4,0 bits/char em tokens ≥ 24 chars. Antes de toda ingestão roda um **canário**; se algum segredo sintético sobreviver, aborta sem gravar. A fixture `testdata/secrets/fake-token.txt` é o barramento versionado |
| D20 | Detectores determinísticos e juiz que aborta | Candidatos a lição saem só de regras SQL sobre o `learn.db` (retrabalho, verificação ausente, disjuntor, overfit de holdout, violação de guarda). Mesmo `learn.db` → mesmos bytes de `LESSONS-PROPOSED.md`. Juiz opcional (`--judge-model`/`--judge-endpoint`): família do `served` atestado ≠ família do modelo de **cada** sessão candidata; igual → exit 7 `same_family_judge`, desconhecida → exit 8 `model_unattested`, **antes** de qualquer chamada ao modelo e **sem** escrever o arquivo (I10, sem fallback). `LESSONS.md` só muda por `pinga learn promote`, ato humano registrado |

D8–D10 continuam: planejador `claude-opus-5-5` (`claude`); executor do GREEN de outra família; juiz `pinga-stable judge` ≠ família do executor (com `--endpoint` do llama-server ativo, como nos EVAL de T09–T11). Modo das T12–T15: `padrao` (D7). Nenhum `touch` desta rodada casa `CRITICAL_RULES` (`src/mode.ts`): nada em `**/db/**`, `**/auth/**`, `**/api/**`, `.github/**` nem lockfile, e por isso nenhuma sobe para `completo`.

## 3. Invariantes

- **I16** (HOME-sombra): nenhum processo de terceiro escreve no HOME real; o real só muda por cópia atômica de bytes da sombra, depois de backup (`backups/<sha256_pre>`, conferido por hash) e de um `--dry-run` com o mesmo diff. Sem `--apply`, zero escrita. Diff vazio → stdout vazio, exit 0, manifest intocado (idempotência). Todo teste de `install`/`doctor`/`learn` roda com `HOME`, `XDG_STATE_HOME` e caminhos em `mkdtemp`.
- **I17** (posse pelo manifest): o `pinga` só cria, altera ou remove entradas que o `manifest.json` registra ou que o adaptador declara como suas. Chave alheia alterada, entrada homônima não registrada ou arquivo-alvo ilegível → recusa sem escrita (exit 11/12). `--revert` só restaura byte a byte quando `sha256(atual) == sha256_post` de **todos** os arquivos; senão nada é escrito (exit 13).
- **I18** (doctor honesto): `status: "ok"` implica `cmd ≠ null`, `exit === 0` e `stdout_sha256 ≠ sha256("")`. Binário ausente nunca dá `ok`. Endpoint fora do ar é `unverified`, nunca `ok`.
- **I19** (índice limpo): nenhum texto entra no `learn.db` sem passar pelo scanner (D19); tokens ausentes são `NULL`, nunca `0` (I4); `model_family = modelFamily(model)` (T08) e `NULL` quando o modelo é `NULL`; reingerir a mesma fonte (mesmo `source_sha256`) não muda o banco.
- **I20** (lição auditável): candidato sem `session_id`, `excerpt` (1..300 chars, redigido) ou métrica é descartado; o juiz só anota (aprovada/rejeitada), nunca cria lição; juiz de mesma família ou não atestado aborta o `propose` inteiro sem escrever; `promote` recusa lição rejeitada e grava trilha (id, sha256 da proposta, autor, data).

## 4. Contratos compartilhados

### 4.1 Recibo e `REASON_CODES`

A rodada 4 **não** acrescenta nada a `REASON_CODES` nem ao recibo v1: `install`, `doctor` e `learn` não gravam no ledger. `tests/receipt.test.ts` entra em `tests_frozen` de T12–T15 e não muda. Os códigos de I10 (`same_family_judge`, `model_unattested`) e de T05/T04/T10 (`breaker_same_failure`, `tests_frozen_changed`, `scope_drift`, `overfit_holdout`) são **lidos** pelos detectores da T15. Se um GREEN precisar de código novo, ele entra no fim da lista e o commit RED correspondente atualiza `tests/receipt.test.ts` (regra da SPEC 0002 §4.1); nenhum contrato desta rodada prevê isso.

### 4.2 Estado fora do repo

```
${XDG_STATE_HOME:-~/.local/state}/pinga/
  ledger.db               T02 (inalterado)
  manifest.json           T12 — posse do pinga (escrita atômica)
  backups/<sha256_pre>    T12 — cópia byte a byte do original
  install-plan.json       T12 — sha256 do último diff do --dry-run
  learn.db                T14
  LESSONS-PROPOSED.md     T15 (padrão; --out muda)
  promotions.jsonl        T15 — trilha do promote
```

Manifest v1 (T12; T13 só acrescenta valores de `harness`):

```ts
type Manifest = { version: 1; entries: ManifestEntry[] };
type ManifestEntry = {
  harness: "claude" | "pi" | "opencode" | "hermes" | "tuios";
  target_file: string;   // relativo ao HOME
  key_path?: string;     // JSON Pointer (RFC 6901); ausente = arquivo inteiro do pinga
  sha256_pre: string;    // 64 hex, ou "absent" se o arquivo não existia
  sha256_post: string;   // 64 hex
  installed_at: string;  // ISO 8601 (PINGA_NOW nos testes)
  backup_path: string;   // absoluto; "" quando sha256_pre === "absent"
};
```

### 4.3 Exit codes do `pinga` (estende SPEC 0002 §4.3)

| Exit | Significado | Desde |
|---|---|---|
| 0 | sucesso (diff vazio, aplicado, revertido, ingerido, proposto) | — |
| 1 | `doctor` com algum `broken`; `promote` recusado | T13, T15 |
| 2 | uso inválido (flag, `--apply` sem `--dry-run` correspondente, `--db` dentro de repo) | T12, T14 |
| 7 / 8 | `same_family_judge` / `model_unattested` ou `infra` (juiz do `propose`) | T15 (reusa T08) |
| 8 | `install`: adaptador lançou erro, CLI nativo falhou na sombra ou a cópia sombra → real não conferiu (backups reaplicados); `learn`: fonte ilegível ou ledger quebrado | T12, T13, T14 |
| **11** | `install`: chave alheia ou entrada homônima não registrada | T12 |
| **12** | `install`: arquivo-alvo ilegível (JSON/YAML inválido) | T12 |
| **13** | `revert`: hash atual ≠ `sha256_post` (drift), nada restaurado | T12 |
| **14** | `revert`: backup ausente ou com hash ≠ nome | T12 |
| **15** | `learn`: canário de redação falhou, nada gravado | T14 |

### 4.4 Doctor: registro por checagem (T13)

```ts
type DoctorRecord = {
  harness: "claude" | "pi" | "opencode" | "hermes" | "tuios" | "llm" | "manifest";
  check: string;
  status: "ok" | "degraded" | "broken" | "unverified";
  law2: "pass" | "fail" | "blocked" | "not run";
  cmd: string[] | null; exit: number | null; stdout_sha256: string | null; duration_ms: number | null;
  detail: string;        // ≤ 200
};
```

## 5. Escopo da rodada 4

| Task | Fase | Entrega | Contrato |
|---|---|---|---|
| T12 | 3 | `pinga install --dry-run\|--apply\|--revert`, HOME-sombra, manifest atômico, backups, guarda A2, adaptador Claude Code | `tasks/T12/` |
| T13 | 3 | adaptadores pi, opencode, Hermes, TUIOS; `install --only`; `pinga doctor [--json] [--only] [--endpoint]` | `tasks/T13/` |
| T14 | 4 | `learn.db`, scanner de segredos + canário, `pinga learn ingest`, `pinga learn scan` | `tasks/T14/` |
| T15 | 4 | detectores determinísticos, `pinga learn propose` (+ juiz que aborta), `LESSONS-PROPOSED.md`, `pinga learn promote` | `tasks/T15/` |

Ordem obrigatória T12 → T13 → T14 → T15 (T13 reusa o motor da T12; T15 lê o schema da T14). Um repo editado por vez (CLAUDE.md do workspace).

## 6. Critérios de aceite

| AC | Critério | Verificação |
|---|---|---|
| AC-12 | install + Claude conforme `tasks/T12/RED.md` | `bun test tests/install.test.ts` |
| AC-13 | adaptadores + doctor conforme `tasks/T13/RED.md` | `bun test tests/adapters.test.ts tests/doctor.test.ts` |
| AC-14 | learn.db + redação conforme `tasks/T14/RED.md` | `bun test tests/redact.test.ts tests/learn.test.ts` |
| AC-15 | detectores + propostas conforme `tasks/T15/RED.md` | `bun test tests/lessons.test.ts` |
| AC-S | suíte inteira verde depois de cada GREEN | `bun test` (pre-commit) |
| AC-DOC | sem binários de harness, nenhum `ok`: `H=$(mktemp -d); S=$(mktemp -d); HOME=$H XDG_STATE_HOME=$S PATH=/usr/bin:/bin bun bin/pinga.ts doctor --json --endpoint http://127.0.0.1:9` → JSON válido, nenhum registro com `status: "ok"`, e todo `status` ∈ os 4 valores de D17 | leitura do JSON (o comando nunca toca o `~` real) |
| AC-SEC | `bun bin/pinga.ts learn scan testdata/secrets/fake-token.txt` → exit 1 com 7 achados (linhas 2, 3, 4, 5, 6, 9 e 10 da fixture, sem imprimir valores); `git ls-files -z \| xargs -0 bun bin/pinga.ts learn scan --allow testdata/secrets/fake-token.txt` → exit 0 | dois comandos no repo |
| AC-J | T12–T15 com recibo `judge` de família ≠ executor e `model_attested.via = "/v1/models"` | `pinga ledger verify` + leitura |
| AC-P | `prove-red` exit 0 no gate do RED de T12–T15 (SPEC 0002 §7.1) | recibo `prove_red` no ledger |
| AC-E | `tasks/TNN/EVAL.md` por `pinga eval`, `--check` exit 0 | `.pinga/pinga-stable eval tasks/TNN/PLAN.md --check` |
| AC-G | gate de saída (SPEC 0001 §8) medido pelo próprio índice: `learn ingest --ledger <ledger> --db $(mktemp -d)/l.db` e `SELECT count(DISTINCT task) FROM session WHERE kind='receipt' AND status='pass' AND tokens_in IS NOT NULL` | número reportado no EVAL da T15; a v0.1 fecha com ≥ 20 |

## 7. Processo por task (atualiza SPEC 0002 §7)

1. Depois do GREEN da T13: `.pinga/pinga-stable doctor` antes de abrir cada task seguinte, e o relatório vai para `tasks/TNN/EXEC.md` (§9.2: "doctor antes de toda task"). O `doctor` só lê (`list`/`status`/`validate` dos harnesses e `GET /v1/models`) e é o único verbo do `pinga` que roda contra o HOME real no processo. `install --apply`/`--revert` no HOME real é decisão do dono, fora de qualquer task. Testes nunca tocam o HOME real (I16).
2. Fixtures versionadas que não estão em `tests/` (só `testdata/secrets/fake-token.txt`, T14) entram num commit **anterior** ao RED (`test(T14): fixture …`): o `precommitDecision` só pula a suíte quando tudo está em `tests/|tasks/|specs/`, e com a suíte ainda verde o commit passa sem `--no-verify`.
3. Commit RED (`test(TNN): RED …`), `.pinga/pinga-stable prove-red tasks/TNN/PLAN.md` exit 0, gate do dono / revisor não-`claude`.
4. Commit GREEN só com o `touch`; `verify` com `PINGA_USAGE_FILE`; `judge`; `eval`; `mise run stable` (iguais à SPEC 0002 §7).

## 8. Fora de escopo (v0.2+)

- `pinga adopt <harness>` (assumir entrada homônima); remoção semântica no `revert` quando o hash diverge (decisão 4 do design); `uninstall` de diretórios vazios criados.
- Distribuição do próprio `pinga` (release, checksums, cosign, A6); stack Go.
- Adaptador agy; perfil `g-inga` do Hermes; correção da chave `plugins` do `opencode.json` do dono.
- Fontes pi JSONL, `opencode.db`, Hermes `state.db`, `FRICTION.md`; detectores de custo fora da curva, fricção de ambiente, correção do usuário, drift de instalação, simplificação; classificação refinada por LLM.
- Medição de precisão na amostra de 30 e replay no bench `petclinic-owners` (gates do §8 do parecer): exigem rótulo humano e ficam `not run` no EVAL da T15.
- Hook de pre-commit com o scanner (exige allowlist da fixture no `hk.pkl`; o AC-SEC cobre o mesmo risco manualmente).

## 9. Riscos e decisões pendentes do dono

- **Escritor próprio do Claude (D16)** em vez de `claude plugin install`: os formatos de §A.2 podem mudar numa versão do Claude Code. Mitigação: o `doctor` roda `claude plugin list`/`validate` (probe real) e acusa `degraded`; delegar ao CLI nativo na sombra fica para quando a hipótese de §A.5 for verificada.
- **Guarda A2 estrita**: as 3 entradas `local` do `pi-harness` e o G-Ingá do OpenCode farão o `install` real recusar (exit 11) até existir `adopt` ou limpeza manual. Aceito: recusar é a decisão segura (decisões 3 e 5 do design).
- **Entropia**: falso positivo em identificadores longos. O token candidato usa só `[A-Za-z0-9+_]` (sem `-`, `/`, `.`, `=`), e hex puro de 40/64 chars é isento (hashes, I9); falso negativo em segredo de baixa entropia é coberto só pela lista de negação.
- **Juiz pequeno** (qwen local) como validador de lição: só anota; o humano promove.