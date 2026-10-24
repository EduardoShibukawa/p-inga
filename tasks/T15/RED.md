# RED T15 — tests/lessons.test.ts

Só `bun:test` e built-ins do Bun 1.4.4 (`bun:sqlite`, `Bun.serve`, `Bun.spawn`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4).

**Isolamento (SPEC 0003 I16/I20):** `learn.db`, `--out`, `LESSONS.md` de destino e `XDG_STATE_HOME` em `mkdtemp(join(realpath(tmpdir()), "pinga-t15-"))`; `HOME` temporário em todo spawn (helper `runPinga` da T12). Nenhum caso escreve em `LESSONS.md` de repo real. O juiz é um `Bun.serve({ port: 0 })` falso no processo do teste que conta as chamadas a `/v1/chat/completions`; por isso os casos com juiz usam `Bun.spawn` **assíncrono** + `await proc.exited` (RED da T08).

Os bancos de teste são montados com `openLearnDb` (T14) e `INSERT` direto na tabela `session`; tokens sintéticos para o caso 7 são montados por concatenação (higiene da fonte da T14).

`REASON_CODES` não muda (SPEC 0003 §4.1): os detectores **leem** `breaker_same_failure`, `overfit_holdout`, `tests_frozen_changed`, `scope_drift`; o juiz reusa `same_family_judge` e `model_unattested` de I10 só como texto no stderr e exit code, sem gravar recibo.

## API esperada

```ts
// src/detect.ts
export const DETECTORS = ["rework", "missing_verification", "breaker_tripped", "overfit_holdout",
  "guard_violation"] as const;
export type Detector = (typeof DETECTORS)[number];
export type LessonClass = "bom" | "ruim" | "simplificar" | "melhorar";
export const REWORK_MIN = 3;
export type Candidate = {
  id: string;                 // "L-" + sha256(detector + "\n" + session_id).slice(0, 12)
  detector: Detector; class: LessonClass;
  session_id: string; harness: string; repo: string | null; task: string | null;
  model: string | null; model_family: string | null;
  metric: string; value: number; baseline: string;
  excerpt: string;            // 1..300 chars, redigido de novo (redactExcerpt, T14)
  action: string; destination: string;
};
export function candidateId(detector: Detector, sessionId: string): string;
export function validateCandidate(x: unknown): { ok: true; candidate: Candidate } | { ok: false; errors: string[] };
export function detect(db: import("bun:sqlite").Database): { candidates: Candidate[]; discarded: number };

// src/lessons.ts
export const PROPOSALS_HEADER = "# LESSONS-PROPOSED — pinga learn propose v1";
export const LESSON_JUDGE_PROMPT_VERSION = 1;
export type Verdict = { verdict: "pass" | "fail"; findings: string[]; served: string; family: string };
export function renderProposals(items: Array<{ candidate: Candidate; verdict: Verdict | null }>): string;
export function parseProposals(text: string):
  | { ok: true; items: Array<{ candidate: Candidate; verdict: Verdict | null }> }
  | { ok: false; errors: string[] };
export function defaultProposalsPath(env?: Record<string, string | undefined>): string; // <state>/pinga/LESSONS-PROPOSED.md
export type ProposeOptions = { db?: string; out?: string; judgeModel?: string; judgeEndpoint?: string;
  env?: Record<string, string | undefined> };
export function proposeCmd(opts: ProposeOptions): Promise<number>;
export type PromoteOptions = { proposals: string; id: string; to: string; by?: string;
  env?: Record<string, string | undefined> };
export function promoteCmd(opts: PromoteOptions): number;
// src/cli.ts — `learn propose`, `learn promote`
```

## Comportamento esperado

1. **Detectores** (SQL sobre `session`, T14; sem LLM, sem relógio):

   | Detector | Linhas | Regra | `metric` / `value` / `baseline` | `class` |
   |---|---|---|---|---|
   | `rework` | `kind = 'transcript'` | `rework_cycles >= REWORK_MIN` | `rework_cycles` / n / `">= 3"` | `ruim` |
   | `missing_verification` | `kind = 'transcript'` | `commits >= 1 AND verification = 'none'` | `commits_without_test` / commits / `"0"` | `ruim` |
   | `breaker_tripped` | `kind = 'receipt'` | `reason_code = 'breaker_same_failure'` | `breaker_trips` / nº de linhas do grupo / `"0"` | `melhorar` |
   | `overfit_holdout` | `kind = 'receipt'` | `reason_code = 'overfit_holdout'` | `overfit_holdout` / nº / `"0"` | `ruim` |
   | `guard_violation` | `kind = 'receipt'` | `reason_code IN ('tests_frozen_changed','scope_drift')` | `guard_violations` / nº / `"0"` | `ruim` |

   - transcripts: um candidato por linha. Recibos: um por grupo `(detector, task)` (`task` nulo → grupo da própria linha); a linha representante é a de menor `(started_at, id)`, e dela vêm `session_id`, `excerpt`, `model`, `model_family`, `harness`, `repo`;
   - `action` é um texto fixo por detector (constante no código, ≤ 280 chars, não vazio); `destination` = `<repo sem "@…">/LESSONS.md` ou `LESSONS.md (raiz)` quando `repo` é nulo (regra editorial do CLAUDE.md do workspace);
   - `excerpt` = `redactExcerpt(row.excerpt)`; `null` → o candidato é **descartado** (`discarded++`), assim como todo candidato que falha no `validateCandidate`;
   - ordem: índice do detector em `DETECTORS`, depois `session_id`. Mesmo conteúdo do banco, em qualquer ordem de inserção → mesma lista.
2. **`validateCandidate`:** exige todas as chaves de `Candidate` e só elas; `id` casa `^L-[0-9a-f]{12}$` e é `candidateId(detector, session_id)`; `detector` ∈ `DETECTORS`; `class` ∈ as 4; `session_id`, `metric`, `baseline`, `action`, `destination` não vazios; `excerpt` com 1..300 chars; `value` inteiro ≥ 0.
3. **`renderProposals`** (bytes só função da entrada; sem data):

   ```
   # LESSONS-PROPOSED — pinga learn propose v1
   <!-- gerado por pinga (T15): não editar; promover com `pinga learn promote` -->

   ## <id> · <detector> · <class>
   - sessão: <session_id> (<harness> · repo <repo|—> · task <task|—>)
   - modelo: <model|—> (<model_family|—>)
   - métrica: <metric> = <value> (baseline <baseline>)
   - trecho: <JSON.stringify(excerpt)>
   - ação: <action>
   - destino: <destination>
   - juiz: <não julgado | aprovada por <served> (<family>) | rejeitada por <served> (<family>): <findings unidos por "; ", cortado em 280>>
   ```

   Itens separados por uma linha vazia, `\n` final. Lista vazia → cabeçalho, comentário, linha vazia e `_nenhum candidato_`. `parseProposals(renderProposals(x))` devolve `x` (round-trip), e texto que não segue o formato → `ok: false`.
4. **`pinga learn propose [--db PATH] [--out PATH] [--judge-model M] [--judge-endpoint URL]`:**
   - `--db` padrão `defaultLearnDbPath()` (T14); inexistente → stderr, exit 8, sem criar; `--out` padrão `defaultProposalsPath()`;
   - **sem** `--judge-model` e `--judge-endpoint`: todo item com `verdict: null`; o juiz **não** é ligado por env;
   - **com** juiz (qualquer uma das duas flags): `endpoint = --judge-endpoint ?? PINGA_JUDGE_ENDPOINT ?? "http://127.0.0.1:8089"`; `attestFromEndpoint(endpoint, judgeModel ?? null)` (T08) com erro → stderr com o `reason_code`, exit 8; `judgeFamily = modelFamily(served)`;
   - **pré-checagem (I10), antes de qualquer chamada ao chat:** para todo candidato, `assertDistinctFamily(candidate.model_family, judgeFamily)` (T08). Algum `same_family_judge` → stderr `same_family_judge: <ids>`, exit 7. Senão algum `model_unattested` → stderr `model_unattested: <ids>`, exit 8. Em ambos, **zero** chamadas a `/v1/chat/completions` e nenhum arquivo escrito (um `--out` já existente fica com os mesmos bytes);
   - depois, um `POST <endpoint>/v1/chat/completions` por candidato, em ordem: `{ model: served, temperature: 0, messages: [system fixo (versão LESSON_JUDGE_PROMPT_VERSION), user = JSON do candidato] }`; `parseVerdict` (T08) no `choices[0].message.content`. HTTP ≠ 200, timeout (`PINGA_JUDGE_TIMEOUT_MS`) ou veredito inválido → exit 8, **nenhum** arquivo (sem proposta parcial);
   - o juiz só anota: `fail` não remove o candidato do arquivo (I20);
   - escrita atômica (`writeAtomic`, T12); stdout `proposed <n> discarded <m> → <out>`; exit 0.
5. **`pinga learn promote <PROPOSED.md> --id <L-…> --to <LESSONS.md> [--by NOME]`:**
   - `parseProposals` falhou ou `--id` ausente no arquivo → exit 2; `--by` padrão `USER` do env; vazio → exit 2;
   - item com `juiz: rejeitada …` → stderr `rejeitada pelo juiz`, exit 1; destino já contém `pinga promote <id>` → stderr `já promovida`, exit 1; nos dois, destino e trilha intocados;
   - senão acrescenta ao fim do `--to` (cria se não existe):

     ```
     - <action> (<detector>: <metric> = <value>, baseline <baseline>; sessão <session_id>)
       <!-- pinga promote <id> · proposta sha256:<sha256 do PROPOSED.md> · por <by> · em <PINGA_NOW ?? agora> -->
     ```

     e uma linha JSON em `<state>/pinga/promotions.jsonl`: `{ id, proposal_sha256, to: <caminho absoluto>, by, at, detector, session_id }`; exit 0. O trecho (`excerpt`) **não** vai para o `LESSONS.md`.
6. **CLI:** flag desconhecida ou sem valor, `learn promote` sem `--id`/`--to` → exit 2. A `USAGE` ganha `pinga learn propose` e `pinga learn promote`.

## Casos

Unitários:

1. `validateCandidate`: um candidato completo → `ok`; sem `session_id`, sem `excerpt`, sem `metric`, `excerpt` de 301 chars, `excerpt: ""`, `detector: "x"`, `value: -1`, chave extra `foo`, `id` que não bate com `candidateId` → cada um `ok: false`.
2. `candidateId("rework", "claude:s1")` casa `^L-[0-9a-f]{12}$`, é estável entre chamadas e muda com o detector ou a sessão.
3. **Detectores**, cada um num `learn.db` próprio com as linhas mínimas:
   - `rework`: transcript com `rework_cycles = 3` → 1 candidato `value: 3`, `baseline: ">= 3"`; com `2` → nenhum;
   - `missing_verification`: `commits = 1`, `verification = 'none'` → 1 candidato; `commits = 0`/`none` → nenhum; `commits = 2`/`pass` → nenhum;
   - `breaker_tripped`: 2 recibos `breaker_same_failure` da task `T05` → 1 candidato `value: 2`, `session_id` = o de menor `started_at`, `class: "melhorar"`;
   - `overfit_holdout`: 1 recibo → 1 candidato `class: "ruim"`;
   - `guard_violation`: `tests_frozen_changed` + `scope_drift` da mesma task → 1 candidato `value: 2`;
   - recibos `same_family_judge`, `command_failed` e transcripts com `verification = 'pass'` → nenhum candidato;
   - linha que dispararia um detector mas tem `excerpt` nulo → `discarded: 1`, fora da lista.
4. **Determinismo:** o mesmo conjunto de linhas inserido em duas ordens diferentes em dois bancos → `detect` igual e `renderProposals` com bytes iguais; ordem do resultado = ordem de `DETECTORS`, depois `session_id`.
5. **Destino:** `repo = 'pi-harness@fix-0047'` → `pi-harness/LESSONS.md`; `repo` nulo → `LESSONS.md (raiz)`.
6. **Round-trip:** `parseProposals(renderProposals(items))` deep-equal a `items`, com `excerpt` contendo `"`, `\` e `·`, e com os três tipos de `juiz`; lista vazia → `_nenhum candidato_` e volta `[]`; texto com `## ` sem `- métrica:` → `ok: false`.
7. **Redação em profundidade:** linha inserida **sem** passar pela T14, com `excerpt` contendo o token `github` montado → o candidato sai com `[REDACTED:github]` e o arquivo renderizado não contém `ghp_`.

CLI `propose` (banco de referência `DB`: um candidato de cada detector, com `model_family` `glm`, `gemini` ou `claude`, mais uma linha com `excerpt` nulo):

8. **Sem juiz:** exit 0; o `--out` existe; 5 itens, todos `juiz: não julgado`; stdout `proposed 5 discarded 1 → <out>`. Sem `--out` → `<XDG_STATE_HOME>/pinga/LESSONS-PROPOSED.md`. `redact` do arquivo inteiro não acha nada.
9. **Juiz distinto:** servidor com `/v1/models` = `{"data":[{"id":"qwen3.5-4b"}]}` e chat que responde `{"verdict":"pass","findings":[]}`, exceto para o candidato `overfit_holdout` (`{"verdict":"fail","findings":["sem evidência de repetição"]}`) → exit 0; 5 chamadas ao chat, todas com `model: "qwen3.5-4b"` e o `id` do candidato no conteúdo do `user`; 4 itens `aprovada por qwen3.5-4b (qwen)` e 1 `rejeitada por qwen3.5-4b (qwen): sem evidência de repetição`; os 5 continuam no arquivo.
10. **Mesma família (I10):** `DB` + um candidato com `model: "qwen3.8-flash"`, `model_family: "qwen"`; juiz `qwen3.5-4b` → exit 7; stderr contém `same_family_judge` e o `id` desse candidato; **0** chamadas ao chat; `--out` inexistente continua inexistente; um `--out` pré-existente mantém os bytes.
11. **Não atestado:** `DB` + um candidato com `model` e `model_family` nulos → exit 8, stderr `model_unattested`, 0 chamadas, nenhum arquivo. Com os dois problemas no mesmo banco → exit 7 (precedência).
12. **Atestado do juiz falha:** `--judge-endpoint http://127.0.0.1:9` → exit 8 (`infra`); servidor com 2 modelos e sem `--judge-model` → exit 8 (`model_unattested`); nos dois, 0 chamadas ao chat e nenhum arquivo.
13. **Falha no meio:** chat com HTTP 500 na 2ª chamada → exit 8 e nenhum arquivo; chat com conteúdo `não sei` (sem JSON) → exit 8 e nenhum arquivo.
14. **Juiz só por flag:** `PINGA_JUDGE_MODEL` e `PINGA_JUDGE_ENDPOINT` no env, sem flags → exit 0, todos `não julgado`, 0 chamadas.
15. **`--db` inexistente** → exit 8 e o arquivo continua inexistente.

CLI `promote` (sobre o arquivo do caso 9; `USER=dono-teste`, `PINGA_NOW` fixo):

16. `--id <aprovada> --to <tmp>/LESSONS.md` → exit 0; o arquivo termina com o bloco do item 5, com `pinga promote <id>`, `proposta sha256:<sha256 do arquivo de propostas>`, `por dono-teste` e o `PINGA_NOW`; sem o `excerpt`; `promotions.jsonl` com 1 linha JSON e as 7 chaves. Repetir → exit 1, `já promovida`, bytes iguais e ainda 1 linha na trilha.
17. `--id <rejeitada>` → exit 1, `rejeitada pelo juiz`, destino inexistente continua inexistente. `--id L-000000000000` → exit 2. Item `não julgado` (arquivo do caso 8) → exit 0. `--by ""` → exit 2.
18. **CLI:** `learn propose --xpto` → 2; `--judge-endpoint` sem valor → 2; `learn promote <arq>` sem `--id` → 2; sem `--to` → 2; a `USAGE` contém `pinga learn propose` e `pinga learn promote`.
