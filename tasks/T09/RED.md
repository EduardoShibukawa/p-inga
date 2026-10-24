# RED T09 — tests/mode.test.ts

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.Glob`, `Bun.spawnSync`, `node:fs`, `node:path`, `node:os`). Zero dependências npm (D4).

## API esperada

```ts
// src/mode.ts
export const MODES = ["mvp", "padrao", "completo"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_RAISED_BY = [
  "requested",
  "diff_touches_migration", "diff_touches_auth", "diff_touches_public_api",
  "diff_touches_ci", "diff_touches_lockfile",
  "night_run", "trunk_branch",
  "operator_override",
] as const;
export type ModeRaisedBy = (typeof MODE_RAISED_BY)[number];
export type CriticalRaise = Extract<ModeRaisedBy, `diff_touches_${string}`>;
export const CRITICAL_RULES: ReadonlyArray<{ raised_by: CriticalRaise; patterns: readonly string[] }>;
export const TRUNK_BRANCHES: readonly string[];                 // ["main", "master"]

export function modeRank(m: Mode): number;                       // mvp 0, padrao 1, completo 2
export function maxMode(a: Mode, b: Mode): Mode;
export function matchesPattern(path: string, pattern: string): boolean;
export function touchesCritical(paths: string[]): { raised_by: CriticalRaise; files: string[] } | null;
export function isTrunkOrNight(branch: string | null, env?: Record<string, string | undefined>):
  "night_run" | "trunk_branch" | null;
export type ModeOverride = { from: Mode; to: Mode; reason: string };
export function parseOverride(mode: string | undefined, reason: string | undefined):
  | { ok: true; override: { mode: Mode; reason: string } | null }
  | { ok: false; error: string };
export type ModeDecision = {
  requested: Mode;
  effective: Mode;
  raised_by: ModeRaisedBy;
  signals: ModeRaisedBy[];        // todo sinal disparado, na ordem de MODE_RAISED_BY, sem "requested"/"operator_override"
  override: ModeOverride | null;
};
export function resolveMode(input: {
  requested: Mode;
  paths: string[];
  branch: string | null;
  env?: Record<string, string | undefined>;      // padrão process.env
  override?: { mode: Mode; reason: string } | null;
}): ModeDecision;
export function currentBranch(repoRoot: string): string | null;
export function modePlan(planPath: string, opts?: { base?: string; overrideMode?: string; reason?: string }): number;

// src/receipt.ts
//   mode_effective?: Mode (enum, antes era string livre)
//   mode_raised_by?: ModeRaisedBy
//   mode_override?: ModeOverride

// src/verify.ts
export type VerifyOptions = { base?: string; usageFile?: string; overrideMode?: string; reason?: string };
```

## Comportamento esperado

1. **Ordem total:** `mvp < padrao < completo`.
2. **`matchesPattern(path, pattern)`:** `new Bun.Glob(pattern).match(path)`; se `pattern` começa com `**/`, também tenta `pattern.slice(3)` (para casar na raiz: `migrations/1.sql` casa `**/migrations/**`). Comparação sensível a maiúsculas.
3. **`CRITICAL_RULES`**, nesta ordem (a ordem é a precedência). Todas sobem para `completo`:

   | `raised_by` | Padrões |
   |---|---|
   | `diff_touches_migration` | `**/migrations/**`, `**/migration/**`, `**/db/**` |
   | `diff_touches_auth` | `**/auth/**`, `**/security/**` |
   | `diff_touches_public_api` | `**/api/**`, `**/routes/**`, `**/openapi.*` |
   | `diff_touches_ci` | `.github/**`, `**/Dockerfile` |
   | `diff_touches_lockfile` | `**/bun.lock`, `**/bun.lockb`, `**/package-lock.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/go.sum`, `**/Cargo.lock`, `**/poetry.lock`, `**/uv.lock` |

   `touchesCritical` devolve a **primeira** regra (na ordem) com algum caminho casando e `files` = os caminhos que casam essa regra, ordenados e sem repetição; `null` se nada casa.
4. **`isTrunkOrNight`:** `env.PINGA_MODE_NIGHT === "1"` → `night_run` (tem precedência); senão `branch ∈ TRUNK_BRANCHES` (igualdade exata) → `trunk_branch`; senão `null`. Os dois sobem para `padrao`.
5. **`resolveMode`:**
   - `computed = max(requested, completo se touchesCritical, padrao se isTrunkOrNight)`;
   - `raised_by`: `"requested"` se `computed === requested` (mesmo com sinais), senão a regra crítica se `computed === "completo"`, senão o sinal de trunk/noite;
   - `signals`: todos os sinais disparados (cada regra crítica que casa, mais `night_run`/`trunk_branch`), na ordem de `MODE_RAISED_BY`;
   - com `override`: `effective = override.mode` (pode descer ou subir), `raised_by = "operator_override"`, `override = { from: computed, to: override.mode, reason }`. Sem override: `effective = computed`, `override: null`;
   - **monotônico**: sem override, `modeRank(effective) >= modeRank(requested)` sempre.
6. **`parseOverride(mode, reason)`:**
   - ambos `undefined` → `{ ok: true, override: null }`;
   - só um dos dois → erro;
   - `mode ∉ MODES` → erro;
   - `reason.trim()` vazio ou com mais de 280 caracteres → erro;
   - ok → `{ mode, reason: reason.trim() }`.
7. **`currentBranch(repoRoot)`:** `git symbolic-ref --short -q HEAD` (funciona em repo sem commits); exit ≠ 0 (HEAD destacado, fora de git) → `null`.
8. **Caminhos dos sinais:** `paths = plan.touch ∪ changedFiles(repoRoot, base)` quando há base (`--base` ou `findRedBase`, como na T04); sem base, só `plan.touch`. O plano (`tasks/<task>/PLAN.md`) e `alwaysAllowed(task)` não entram como sinal.
9. **`pinga mode <PLAN.md> [--base SHA] [--override-mode M --reason TEXTO]`:**
   - só lê: não abre ledger, não roda `done_when`, não grava nada;
   - plano inválido → stderr, exit 3; `--base` inválida → stderr `base inválida`, exit 2; `parseOverride` com erro → stderr, exit 2;
   - ok → stdout com uma linha `canonicalJson({ task, ...ModeDecision })`, exit 0.
10. **Integração no `verify`:**
    - `parseOverride` com erro → exit 2, **nenhum** recibo;
    - todo recibo gerado **depois** de o plano ser válido (guardas, pass, fail, timeout, disjuntor) ganha `mode_effective`, `mode_raised_by` e, só com override, `mode_override`;
    - o recibo `plan_invalid` **não** ganha campos de modo;
    - `status: "pass"` com `mode_effective: "completo"` → também `flow: "awaiting_judge"` e `next_action: "pinga judge"`. O exit continua 0;
    - o modo não muda status nem exit em nenhum outro caso.
11. **`validateReceipt`:**
    - `mode_effective` ∉ `MODES` → erro; `mode_raised_by` ∉ `MODE_RAISED_BY` → erro;
    - `mode_override`: objeto com exatamente `from` e `to` (∈ `MODES`) e `reason` (string 1..280); chave extra → `unknown field: mode_override.<chave>`;
    - `mode_raised_by === "operator_override"` ⇔ `mode_override` presente; qualquer um sem o outro → erro.
12. **CLI do verify:** `pinga verify <PLAN.md> [--ledger PATH] [--attempt N] [--base SHA] [--usage-file PATH] [--override-mode M --reason TEXTO]`. Flag sem valor → exit 2. A `USAGE` ganha a linha do `mode` e as flags novas do `verify`.

## Casos

Unitários:

1. `modeRank`: 0, 1, 2. `maxMode("mvp","completo") === "completo"`, `maxMode("padrao","mvp") === "padrao"`.
2. `touchesCritical` com um caminho por vez:

   | Caminho | Resultado |
   |---|---|
   | `db/migrations/001.sql`, `migrations/001.sql`, `src/db/schema.ts` | `diff_touches_migration` |
   | `src/auth/login.ts`, `app/security/Policy.java` | `diff_touches_auth` |
   | `src/api/owners.ts`, `src/routes/index.ts`, `openapi.yaml`, `docs/openapi.json` | `diff_touches_public_api` |
   | `.github/workflows/ci.yml`, `Dockerfile`, `docker/Dockerfile` | `diff_touches_ci` |
   | `bun.lock`, `bun.lockb`, `package-lock.json`, `web/yarn.lock`, `go.sum` | `diff_touches_lockfile` |
   | `src/a.ts`, `README.md`, `src/authors.ts`, `src/apiary.ts`, `Dockerfile.md` | `null` |

3. Precedência: `["bun.lock", ".github/x.yml", "src/auth/b.ts", "src/auth/a.ts", "src/auth/a.ts"]` → `{ raised_by: "diff_touches_auth", files: ["src/auth/a.ts", "src/auth/b.ts"] }`.
4. `isTrunkOrNight`:
   - `("main", {})` e `("master", {})` → `trunk_branch`;
   - `("feat/x", {})`, `("mainline", {})`, `(null, {})`, `("feat/x", { PINGA_MODE_NIGHT: "0" })` → `null`;
   - `("feat/x", { PINGA_MODE_NIGHT: "1" })` e `("main", { PINGA_MODE_NIGHT: "1" })` → `night_run`.
5. `resolveMode` (env `{}` salvo indicação):

   | requested | paths | branch | effective | raised_by | signals |
   |---|---|---|---|---|---|
   | mvp | `[]` | `feat/x` | mvp | requested | `[]` |
   | mvp | `[]` | `main` | padrao | trunk_branch | `["trunk_branch"]` |
   | mvp | `["db/m/1.sql"]` | `main` | completo | diff_touches_migration | `["diff_touches_migration","trunk_branch"]` |
   | padrao | `[]` | `main` | padrao | requested | `["trunk_branch"]` |
   | completo | `[]` | `feat/x` | completo | requested | `[]` |
   | completo | `["src/auth/a.ts"]` | `feat/x` | completo | requested | `["diff_touches_auth"]` |
   | padrao | `["bun.lock", "src/api/x.ts"]` | `feat/x` | completo | diff_touches_public_api | `["diff_touches_public_api","diff_touches_lockfile"]` |
   | mvp | `[]` | `feat/x` + `PINGA_MODE_NIGHT=1` | padrao | night_run | `["night_run"]` |

6. Override: `requested: "padrao"`, `paths: ["db/m/1.sql"]`, `branch: "main"`, `override: { mode: "mvp", reason: "spike descartável" }` → `effective: "mvp"`, `raised_by: "operator_override"`, `override: { from: "completo", to: "mvp", reason: "spike descartável" }`. Override igual ao calculado (`completo`) também é registrado.
7. Monotonia: para todo `requested` ∈ `MODES` e as linhas da tabela do caso 5, sem override, `modeRank(effective) >= modeRank(requested)`.
8. `parseOverride`:
   - `(undefined, undefined)` → `override: null`;
   - `("mvp", undefined)` e `(undefined, "x")` → erro;
   - `("rapido", "x")` → erro;
   - `("mvp", "   ")` e `("mvp", "a".repeat(281))` → erro;
   - `("mvp", "  ok  ")` → `{ mode: "mvp", reason: "ok" }`.
9. `validateReceipt`:
   - `mode_effective: "rapido"` → erro; `mode_raised_by: "x"` → erro;
   - `mode_raised_by: "operator_override"` sem `mode_override` → erro, e vice-versa;
   - `mode_override` com chave `extra` → erro com `mode_override.extra`;
   - `mode_effective: "completo"`, `mode_raised_by: "diff_touches_ci"` → ok.
10. `currentBranch`: repo novo `git init -q -b main` sem commits → `"main"`; depois de `git checkout -q -b feat/x` → `"feat/x"`; HEAD destacado (`git checkout -q --detach`) → `null`.

CLI. Repo git temporário (`git init -q -b main`, depois `git checkout -q -b feat/x` salvo indicação) com `tasks/TX/PLAN.md` e ledger temporário fora do repo. O CLI é chamado como `bun <ROOT>/bin/pinga.ts ...`, com `PINGA_MODE_NIGHT` removido do env filho salvo indicação.

11. `pinga mode`, plano `mvp` com `touch: ["src/a.ts"]`, sem RED → exit 0, stdout com `effective: "mvp"`, `raised_by: "requested"`, `task: "TX"`; nenhum arquivo novo no repo nem no diretório do ledger.
12. `touch: ["src/a.ts", "db/migrations/001.sql"]`, sem diff → `completo`, `diff_touches_migration` (sinal no momento do plano).
13. Com commits `chore: init` e `test(TX): RED`, criar `.github/workflows/x.yml` untracked → `completo`, `diff_touches_ci`. Com `--base <sha do init>`, também.
14. Branch `main` → `padrao`, `trunk_branch`. Em `feat/x` com `PINGA_MODE_NIGHT=1` → `night_run`.
15. `--override-mode mvp --reason "x"` com sinal de migração → `operator_override`, `override.from === "completo"`. `--override-mode mvp` sem `--reason` → exit 2; `--override-mode rapido --reason x` → exit 2; `--reason x` sozinho → exit 2.
16. `verify` em `feat/x`, plano `mvp`, `done_when: "true"` → exit 0, recibo com `mode_effective: "mvp"`, `mode_raised_by: "requested"`, sem `flow` e sem `mode_override`.
17. `verify` em `main`, mesmo plano → `mode_effective: "padrao"`, `mode_raised_by: "trunk_branch"`.
18. `verify` em `feat/x`, plano `padrao` com `touch: ["src/auth/login.ts"]`, `done_when: "true"` → exit 0, `mode_effective: "completo"`, `mode_raised_by: "diff_touches_auth"`, `flow: "awaiting_judge"`, `next_action: "pinga judge"`.
19. Mesmo plano com `done_when: "exit 7"` → exit 1, `fail`, campos de modo presentes, sem `flow`.
20. Bloqueio de guarda: depois do RED, `src/extra.ts` untracked → exit 6, `scope_drift` com campos de modo. Plano de 26 linhas → exit 3, `plan_invalid` **sem** `mode_effective`.
21. `verify --override-mode padrao --reason "auth só em teste"` no plano do caso 18 → exit 0, `mode_effective: "padrao"`, `mode_raised_by: "operator_override"`, `mode_override: { from: "completo", to: "padrao", reason: "auth só em teste" }`, sem `flow`.
22. `verify --override-mode mvp` sem `--reason` → exit 2 e o ledger mantém o número de linhas.
23. Integração: todo recibo impresso nos casos 16–21 passa no `validateReceipt`, e `pinga ledger verify --ledger <tmp>` dá `ok <n>`.
