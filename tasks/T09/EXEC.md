# EXEC T09 — Roteador de modo monotônico (I12)

Você é o **EXECUTOR** (`opencode/glm-5.3-flash-free`) da tarefa **T09** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T09/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T09/RED.md` e `specs/0002-p-inga-v0.1-rodada-3.md`
- **`done_when`:** `bun test tests/mode.test.ts` (e a suíte inteira `bun test` também deve passar porque o hook pre-commit roda `bun bin/pinga.ts precommit -- bun test`).
- **`touch` permitido:** `["src/mode.ts", "src/verify.ts", "src/receipt.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Zero dependências npm** (apenas Bun 1.4.4 built-ins: `Bun.Glob`, `Bun.spawnSync`, `node:fs`, `node:path`, `node:os`). Não use `bunx tsc`.

## O que implementar

### 1. `src/mode.ts`
Exporte exatamente a API especificada em `tasks/T09/RED.md`:
- `MODES = ["mvp", "padrao", "completo"] as const` e `type Mode = (typeof MODES)[number]`
- `MODE_RAISED_BY = ["requested", "diff_touches_migration", "diff_touches_auth", "diff_touches_public_api", "diff_touches_ci", "diff_touches_lockfile", "night_run", "trunk_branch", "operator_override"] as const` e `type ModeRaisedBy = (typeof MODE_RAISED_BY)[number]`
- `type CriticalRaise = Extract<ModeRaisedBy, \`diff_touches_\${string}\`>`
- `CRITICAL_RULES: ReadonlyArray<{ raised_by: CriticalRaise; patterns: readonly string[] }>` na ordem:
  1. `diff_touches_migration`: `["**/migrations/**", "**/migration/**", "**/db/**"]`
  2. `diff_touches_auth`: `["**/auth/**", "**/security/**"]`
  3. `diff_touches_public_api`: `["**/api/**", "**/routes/**", "**/openapi.*"]`
  4. `diff_touches_ci`: `[".github/**", "**/Dockerfile"]`
  5. `diff_touches_lockfile`: `["**/bun.lock", "**/bun.lockb", "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/go.sum", "**/Cargo.lock", "**/poetry.lock", "**/uv.lock"]`
- `TRUNK_BRANCHES: readonly string[] = ["main", "master"]`
- `modeRank(m: Mode): number` (`mvp` -> 0, `padrao` -> 1, `completo` -> 2)
- `maxMode(a: Mode, b: Mode): Mode`
- `matchesPattern(path: string, pattern: string): boolean`:
  - `new Bun.Glob(pattern).match(path)`; se `pattern.startsWith("**/")`, também tenta `new Bun.Glob(pattern.slice(3)).match(path)`.
- `touchesCritical(paths: string[]): { raised_by: CriticalRaise; files: string[] } | null`:
  - Percorre `CRITICAL_RULES` em ordem; para a primeira regra que casar algum caminho, retorna `{ raised_by: rule.raised_by, files }` com `files` ordenados lexicograficamente e sem repetição; senão `null`.
- `isTrunkOrNight(branch: string | null, env: Record<string, string | undefined> = process.env): "night_run" | "trunk_branch" | null`:
  - `env.PINGA_MODE_NIGHT === "1"` -> `"night_run"` (precedência sobre branch)
  - senão `branch !== null && TRUNK_BRANCHES.includes(branch)` -> `"trunk_branch"`
  - senão `null`
- `type ModeOverride = { from: Mode; to: Mode; reason: string }`
- `parseOverride(mode: string | undefined, reason: string | undefined): { ok: true; override: { mode: Mode; reason: string } | null } | { ok: false; error: string }`:
  - ambos `undefined` -> `{ ok: true, override: null }`
  - só um definido -> `{ ok: false, error: "--override-mode e --reason devem ser informados juntos" }`
  - `mode` fora de `MODES` -> `{ ok: false, error: \`override-mode inválido: \${mode}\` }`
  - `reason.trim()` vazio ou `reason.trim().length > 280` -> `{ ok: false, error: "reason deve ter entre 1 e 280 caracteres" }`
  - ok -> `{ ok: true, override: { mode: mode as Mode, reason: reason.trim() } }`
- `type ModeDecision = { requested: Mode; effective: Mode; raised_by: ModeRaisedBy; signals: ModeRaisedBy[]; override: ModeOverride | null }`
- `resolveMode(input: { requested: Mode; paths: string[]; branch: string | null; env?: Record<string, string | undefined>; override?: { mode: Mode; reason: string } | null }): ModeDecision`:
  - Coleta todos os sinais disparados na ordem de `MODE_RAISED_BY` (todas as `CRITICAL_RULES` que casarem pelo menos 1 caminho em `input.paths`, seguidas de `isTrunkOrNight(input.branch, env)` se não nulo).
  - `crit = touchesCritical(input.paths)`
  - `tn = isTrunkOrNight(input.branch, env)`
  - `computed = input.requested`
  - se `tn` não nulo, `computed = maxMode(computed, "padrao")`
  - se `crit` não nulo, `computed = maxMode(computed, "completo")`
  - `computedRaisedBy`: se `computed === input.requested` -> `"requested"`; senão se `computed === "completo"` e `crit` -> `crit.raised_by`; senão `tn!`
  - Se `input.override` presente:
    - `effective = input.override.mode`
    - `raised_by = "operator_override"`
    - `override = { from: computed, to: input.override.mode, reason: input.override.reason }`
  - Sem override:
    - `effective = computed`, `raised_by = computedRaisedBy`, `override = null`
- `currentBranch(repoRoot: string): string | null`:
  - Roda `git symbolic-ref --short -q HEAD` em `cwd: repoRoot`; se `exitCode !== 0`, retorna `null`, senão `stdout.trim() || null`.
- `modePlan(planPath: string, opts?: { base?: string; overrideMode?: string; reason?: string }): number`:
  - Valida `parseOverride(opts?.overrideMode, opts?.reason)`; se `!ok`, escreve em stderr e retorna `2`.
  - Lê o arquivo `planPath` (se não existir, stderr e retorna `3`), valida `parsePlan(raw)` (se `!ok`, stderr e retorna `3`).
  - Resolve `repoRoot = findRepoRoot(dirname(resolve(planPath))) ?? dirname(resolve(planPath))` e `task = inferTaskId(planPath)`.
  - Se `opts?.base !== undefined`, valida `resolveCommit(repoRoot, opts.base)`; se `null`, escreve `base inválida` em stderr e retorna `2`.
  - `baseSha = opts?.base !== undefined ? resolveCommit(...) : findRedBase(repoRoot, task)`.
  - `paths = baseSha ? Array.from(new Set([...plan.touch, ...changedFiles(repoRoot, baseSha)])) : [...plan.touch]`.
  - `branch = currentBranch(repoRoot)`.
  - `decision = resolveMode({ requested: plan.mode, paths, branch, env: process.env, override: parsedOverride.override })`.
  - Imprime `canonicalJson({ task, ...decision }) + "\n"` no stdout e retorna `0`.

### 2. `src/receipt.ts`
- Atualize `ReceiptV1`:
  - `mode_effective?: Mode`
  - `mode_raised_by?: ModeRaisedBy`
  - `mode_override?: ModeOverride`
- Em `validateReceipt`:
  - Valide `mode_effective` (quando presente) em `MODES`.
  - Valide `mode_raised_by` (quando presente) em `MODE_RAISED_BY`.
  - Valide `mode_override` (quando presente): deve ser plain object, chaves permitidas apenas `from`, `to`, `reason` (chave extra -> `unknown field: mode_override.<chave>`), `from` e `to` em `MODES`, `reason` string com `reason.trim().length >= 1 && reason.length <= 280`.
  - Regra bicondicional: `mode_raised_by === "operator_override"` se e somente se `mode_override !== undefined` (se um estiver presente sem o outro, retorne erro em `errors`).
  - Certifique-se de que `ALLOWED_TOP_KEYS` inclui `"mode_raised_by"` e `"mode_override"` (além de `"mode_effective"` que já existia).

### 3. `src/verify.ts`
- `export type VerifyOptions = { base?: string; usageFile?: string; overrideMode?: string; reason?: string };`
- No início de `verifyPlan`:
  - Valide `parseOverride(opts.overrideMode, opts.reason)`; se `!ok`, escreva em `process.stderr` e retorne `2` **sem** gravar recibo no ledger.
  - Mantenha a validação de `--base` e `--usage-file` que retornam `2` sem gravar recibo.
  - Se o plano for inválido (`plan_invalid`, exit 3), o recibo **não** leva `mode_effective`, `mode_raised_by` nem `mode_override`.
  - Assim que o plano é válido, calcule a decisão de modo com `paths = baseSha ? Array.from(new Set([...plan.touch, ...changedFiles(repoRoot, baseSha)])) : [...plan.touch]` e `branch = currentBranch(repoRoot)`:
    - Todo recibo gerado a partir daí (`tests_frozen_changed` exit 5, `scope_drift` exit 6, `pass` exit 0, `fail` exit 1, timeout `budget` exit 124, e se o disjuntor disparar `breaker_same_failure` exit 4) recebe:
      - `mode_effective: decision.effective`
      - `mode_raised_by: decision.raised_by`
      - e, se `decision.override !== null`, `mode_override: decision.override`.
    - Nota importante sobre `breaker.ts`: se o disjuntor criar um recibo de falha, garanta que o recibo do disjuntor também receba `mode_effective`, `mode_raised_by` (e `mode_override` se houver) ou propague do `lastReceipt`.
    - Quando o recibo for `status: "pass"` e `decision.effective === "completo"`, inclua também no recibo:
      - `flow: "awaiting_judge"`
      - `next_action: "pinga judge"`
      (mantendo exit code `0`).

### 4. `src/cli.ts`
- Adicione o subcomando `mode`:
  `pinga mode <PLAN.md> [--base SHA] [--override-mode M --reason TEXTO]`
- No `verify`, aceite também `--override-mode <M>` e `--reason <TEXTO>` (flag sem valor -> exit 2) e passe `overrideMode` e `reason` para `verifyPlan`.
- Atualize `USAGE` com a linha de `pinga mode` e as novas flags de `pinga verify`.

## Regras de Git e Finalização
1. Rode `bun test tests/mode.test.ts` e `bun test` até que **todos** os testes passem.
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` (`src/mode.ts`, `src/verify.ts`, `src/receipt.ts`, `src/cli.ts`) foi modificado.
3. Faça o commit GREEN com caminhos explícitos (NUNCA use `git add .` ou `-A` ou `--no-verify`):
   ```bash
   git add src/mode.ts src/verify.ts src/receipt.ts src/cli.ts
   git commit -m "feat(T09): roteador de modo monotônico (I12)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN. Não edite `tasks/T09/PLAN.md` nem `EVAL.md`.
