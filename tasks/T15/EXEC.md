# EXEC T15 — Detectores Determinísticos e `LESSONS-PROPOSED.md` (D20 / I20)

## Relatório pré-task (`pinga-stable doctor --endpoint http://127.0.0.1:8001`)
```text
unverified manifest/integrity: nada instalado (manifest ausente)
ok pi/global_status: skills instaladas
degraded claude/plugin_list: plugin pi-harness ausente em plugin list
broken claude/plugin_validate: plugin validate exit 1
degraded opencode/plugin_list: plugin pi-harness ausente
degraded hermes/plugins_list: linha do plugin pi-harness ausente
broken hermes/doctor: hermes doctor exit 1
degraded tuios/integration_status: integração não instalada em alguma parte
ok llm/models: served qwen2.5-3b-instruct
```

Você é o **EXECUTOR** (`opencode/glm-5.3-flash`) da tarefa **T15** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T15/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T15/RED.md` e `specs/0003-p-inga-v0.1-rodada-4.md`
- **`done_when`:** `bun test tests/lessons.test.ts` (e a suíte inteira `bun test` também deve passar no pre-commit).
- **`touch` permitido (ESTRITO — não crie nem altere nenhum outro arquivo em `src/`):** `["src/detect.ts", "src/lessons.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/lessons.test.ts", "tests/learn.test.ts", "tests/redact.test.ts", "testdata/secrets/fake-token.txt", "tests/adapters.test.ts", "tests/doctor.test.ts", "tests/helpers/stubs.ts", "tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Zero dependências npm** (apenas Bun 1.4.4 built-ins). Não use `bunx tsc`.

## O que implementar

### 1. `src/detect.ts`
Exporte exatamente a API de `tasks/T15/RED.md`:
- `export const DETECTORS = ["rework", "missing_verification", "breaker_tripped", "overfit_holdout", "guard_violation"] as const;`
- `export type Detector = (typeof DETECTORS)[number];`
- `export type LessonClass = "bom" | "ruim" | "simplificar" | "melhorar";`
- `export const REWORK_MIN = 3;`
- `export type Candidate = { id: string; detector: Detector; class: LessonClass; session_id: string; harness: string; repo: string | null; task: string | null; model: string | null; model_family: string | null; metric: string; value: number; baseline: string; excerpt: string; action: string; destination: string };`
- `export function candidateId(detector: Detector, sessionId: string): string`:
  - `"L-" + sha256hex(\`${detector}\\n${sessionId}\`).slice(0, 12)`
- `export function validateCandidate(x: unknown): { ok: true; candidate: Candidate } | { ok: false; errors: string[] }`:
  - Valida objeto plano com exatamente as 15 chaves de `Candidate` (qualquer chave faltando ou extra -> erro);
  - `detector` em `DETECTORS`; `class` em `["bom", "ruim", "simplificar", "melhorar"]`;
  - `id` casa `/^L-[0-9a-f]{12}$/` e deve ser igual a `candidateId(detector, session_id)`;
  - `session_id`, `harness`, `metric`, `baseline`, `action`, `destination` strings não vazias (`.trim().length > 0`);
  - `excerpt` string com `1 <= excerpt.length <= 300`;
  - `value` inteiro `>= 0`;
  - `repo`, `task`, `model`, `model_family` `string | null`.
- `export function detect(db: import("bun:sqlite").Database): { candidates: Candidate[]; discarded: number }`:
  - Siga rigorosamente a tabela e regras do item 1 de `tasks/T15/RED.md`:
    1. `rework`: linhas com `kind = 'transcript' AND rework_cycles >= 3`, `metric: "rework_cycles"`, `value: row.rework_cycles`, `baseline: ">= 3"`, `class: "ruim"`.
    2. `missing_verification`: linhas com `kind = 'transcript' AND commits >= 1 AND verification = 'none'`, `metric: "commits_without_test"`, `value: row.commits`, `baseline: "0"`, `class: "ruim"`.
    3. `breaker_tripped`: linhas com `kind = 'receipt' AND reason_code = 'breaker_same_failure'`, agrupadas por `task` (`task === null` -> grupo da própria linha `id`); representante = menor `(started_at, id)`; `metric: "breaker_trips"`, `value: count`, `baseline: "0"`, `class: "melhorar"`.
    4. `overfit_holdout`: linhas com `kind = 'receipt' AND reason_code = 'overfit_holdout'`, agrupadas por `task` (`task === null` -> própria linha); representante = menor `(started_at, id)`; `metric: "overfit_holdout"`, `value: count`, `baseline: "0"`, `class: "ruim"`.
    5. `guard_violation`: linhas com `kind = 'receipt' AND reason_code IN ('tests_frozen_changed', 'scope_drift')`, agrupadas por `task` (`task === null` -> própria linha); representante = menor `(started_at, id)`; `metric: "guard_violations"`, `value: count`, `baseline: "0"`, `class: "ruim"`.
  - Para cada candidato bruto:
    - `excerpt = redactExcerpt(row.excerpt)`; se `excerpt === null`, incrementa `discarded++` e descarta!
    - `destination = row.repo ? \`\${row.repo.split("@")[0]}/LESSONS.md\` : "LESSONS.md (raiz)"`.
    - `action`: texto fixo por detector (<= 280 chars, não vazio).
    - Valida com `validateCandidate`; se `!ok`, incrementa `discarded++` e descarta.
  - Ordena `candidates` por índice de `detector` em `DETECTORS`, e depois `session_id` lexicograficamente.

### 2. `src/lessons.ts`
Exporte exatamente a API de `tasks/T15/RED.md`:
- `export const PROPOSALS_HEADER = "# LESSONS-PROPOSED — pinga learn propose v1";`
- `export const LESSON_JUDGE_PROMPT_VERSION = 1;`
- `export type Verdict = { verdict: "pass" | "fail"; findings: string[]; served: string; family: string };`
- `export function renderProposals(items: Array<{ candidate: Candidate; verdict: Verdict | null }>): string` e `export function parseProposals(text: string)`:
  - Formato exato do item 3 de `tasks/T15/RED.md`:
    ```markdown
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
  - Garanta que `parseProposals(renderProposals(items))` faz round-trip perfeito (`toEqual(items)`), inclusive para lista vazia (`_nenhum candidato_`) e para `findings` separados por `"; "`.
- `export function defaultProposalsPath(env?: Record<string, string | undefined>): string` -> `join(defaultStateDir(env), "LESSONS-PROPOSED.md")`
- `export async function proposeCmd(opts: ProposeOptions): Promise<number>`:
  - Implemente rigorosamente o item 4 de `tasks/T15/RED.md`:
    - Se o arquivo `--db` não existir, escreva no stderr e retorne `8` (sem criar o banco nem o arquivo `--out`).
    - O juiz só é ativado se `opts.judgeModel !== undefined || opts.judgeEndpoint !== undefined` (NÃO ative apenas por variáveis de ambiente!).
    - Quando o juiz está ativado:
      1. `attestFromEndpoint(endpoint, opts.judgeModel ?? null)` -> se `!ok`, stderr com `reason_code`, retorna `8` (0 chamadas ao chat, nenhum arquivo escrito).
      2. **Pré-checagem I10 sobre TODOS os candidatos antes de qualquer chamada ao chat**:
         - Verifica se algum candidato colide com `judgeFamily` (`same_family_judge`) e se algum tem família nula/desconhecida (`model_unattested`).
         - Se houver qualquer `same_family_judge` (tem precedência sobre `model_unattested`! Veja caso 11): escreva `same_family_judge: <ids>` no stderr e retorne `7` sem chamar o chat e sem tocar em `--out`!
         - Senão, se houver qualquer `model_unattested`: escreva `model_unattested: <ids>` no stderr e retorne `8` sem chamar o chat e sem tocar em `--out`!
      3. Faz 1 chamada `POST <endpoint>/v1/chat/completions` por candidato em ordem (`{ model: served, temperature: 0, messages: [{ role: "system", content: ... }, { role: "user", content: JSON.stringify(candidate) }] }`), fazendo `parseVerdict` na resposta. Se qualquer chamada falhar (HTTP != 200, timeout, JSON inválido), retorne `8` sem escrever o arquivo!
    - Escreve o arquivo com `writeAtomic(outPath, renderProposals(items))` e imprime `proposed ${candidates.length} discarded ${discarded} → ${outPath}` no stdout, retornando `0`.
- `export function promoteCmd(opts: PromoteOptions): number`:
  - Implemente rigorosamente o item 5 de `tasks/T15/RED.md`.

### 3. `src/cli.ts`
- Em `learn`, adicione os subcomandos `propose` e `promote` conforme os itens 4, 5 e 6 de `tasks/T15/RED.md`.
- Atualize `USAGE` com `pinga learn propose` e `pinga learn promote`.

## Regras de Git e Finalização
1. Rode `bun test tests/lessons.test.ts` e `bun test` até que **todos** os testes passem.
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` (`src/detect.ts`, `src/lessons.ts`, `src/cli.ts`) foi modificado.
3. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add src/detect.ts src/lessons.ts src/cli.ts
   git commit -m "feat(T15): detectores determinísticos e LESSONS-PROPOSED.md (I20)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN.
