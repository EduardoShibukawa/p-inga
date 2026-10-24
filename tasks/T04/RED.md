# RED T04 — tests/guards.test.ts

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.spawnSync`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4); nada de `bunx tsc`.

## API esperada

```ts
// src/guards.ts
export const GUARD_EXIT = { tests_frozen_changed: 5, scope_drift: 6 } as const;

export type GuardInput = {
  task: string;
  touch?: string[];
  tests_frozen?: string[];
  changed: string[];            // caminhos relativos à raiz do repo
};
export type GuardResult =
  | { ok: true }
  | { ok: false; reason_code: "tests_frozen_changed"; files: string[]; exit: 5 }
  | { ok: false; reason_code: "scope_drift"; files: string[]; exit: 6 };

export function alwaysAllowed(task: string): string[];
//   [`tasks/${task}/EXEC.md`, `tasks/${task}/EVAL.md`]
export function evaluateGuards(input: GuardInput): GuardResult;           // pura, sem I/O
export function findRedBase(repoRoot: string, task: string): string | null;
//   sha (40 hex) do commit mais recente cujo assunto começa com `test(${task}): RED`; null se não houver
export function changedFiles(repoRoot: string, base: string): string[];
//   ordenado e sem repetição
export function precommitDecision(staged: string[]): "skip" | "test";

// src/verify.ts (assinatura da T03 estendida, compatível)
export type VerifyOptions = { base?: string };
export function verifyPlan(
  planPath: string, ledgerPathArg?: string, attemptArg?: number, opts?: VerifyOptions,
): number;
```

## Comportamento esperado

1. **Ordem no `pinga verify`:** lint do plano (T03, exit 3) → guardas → `done_when`.
2. **Base:**
   - `--base <sha>`: resolvida com `git rev-parse --verify --quiet <sha>^{commit}` na raiz do repo. Se não resolver → stderr `base inválida: <sha>`, exit 2, **nenhum recibo** gravado.
   - sem `--base`: `findRedBase(repoRoot, task)`, varrendo `git log --format=%H%x09%s` da `HEAD`. O match é por prefixo exato `test(${task}): RED` (então `test(TX1): RED` não casa com `TX`).
   - sem base (nenhum commit RED, repo sem commits): as guardas são **puladas** e o verify age como na T03. Isso mantém `tests/verify.test.ts` verde.
3. **Arquivos alterados** (`changedFiles`), relativos à raiz:
   - `git diff --name-only --no-renames <base>` (base → árvore atual: commits posteriores, staged e unstaged, incluindo deleções)
   - ∪ `git ls-files --others --exclude-standard` (untracked não ignorados).
4. **`evaluateGuards`** (`files` sempre ordenado):
   - `tests_frozen` presente e `changed ∩ tests_frozen ≠ ∅` → `tests_frozen_changed`, exit 5. Esta regra tem precedência.
   - senão, `touch` presente e existe `f ∈ changed` com `f ∉ touch` e `f ∉ alwaysAllowed(task)` → `scope_drift`, exit 6. A comparação é por igualdade exata de caminho.
   - lista ausente → a checagem correspondente é pulada.
   - `EXEC.md`/`EVAL.md` de **outra** task, ou `tasks/<task>/PLAN.md`, não são liberados.
5. **Recibo bloqueado:** se as guardas falham, o `done_when` **não roda** (sem `runs/<task>/<attempt>/out.txt`). O recibo passa no `validateReceipt` com:
   - `status: "blocked"`, `reason_code` da guarda, `evidence: []`;
   - tokens `null`, `cost_evidence: "not run"`, `attempts` como na T03;
   - `summary`: `` `${task} blocked: tests_frozen alterado (${files.join(", ")})` `` ou `` `${task} blocked: fora do touch (${files.join(", ")})` ``, cortado em 280.

   Vai pro ledger e pro stdout; o exit do `pinga` é 5 ou 6.
6. **CLI:** `pinga verify <PLAN.md> [--ledger PATH] [--attempt N] [--base SHA]`. `--base` sem valor → exit 2.
7. **`pinga precommit [-- <cmd...>]`** (cmd padrão: `bun test`):
   - lê `git diff --cached --name-only` no `cwd`;
   - `precommitDecision`: `"skip"` se a lista **não é vazia** e todo caminho começa com `tests/`, `tasks/` ou `specs/` (commits RED e docs, inclusive `tasks/<task>/EXEC.md`/`EVAL.md`). Senão, `"test"`;
   - `skip` → stdout `precommit: só tests/, tasks/ e specs/ staged; suíte pulada`, exit 0;
   - `test` → roda `<cmd...>` com stdio herdado e devolve o exit dele (`null` → 1).
8. **mise.toml:**
   - `[tools]` ganha `pkl = "0.32.1"`, mantendo `bun = "1.4.4"` e `hk = "1.24.0"`;
   - `[tasks.pre-commit]` passa a `run = "bun bin/pinga.ts precommit -- bun test"`. Continua contendo `bun test`, como exige `tests/repo.test.ts`.

## Casos

Os casos com git usam um repo temporário (`mkdtemp` + `git init -q -b main` + `git config user.email/user.name` locais) e um ledger temporário. O plano de teste tem:
- `touch: ["src/a.ts"]`;
- `tests_frozen: ["tests/a.test.ts"]`;
- `done_when: "touch ran.flag"`, para provar se rodou ou não.

Cada caso de CLI usa seu próprio repo, montado assim:
- commit `chore: init` com:
  - `tasks/TX/PLAN.md`, `src/a.ts`, `src/d.ts`, `tests/a.test.ts`;
  - `.gitignore` com `runs/`, `.pinga/`, `*.db` e `ran.flag`;
- commit `test(TX): RED`, que altera `tests/a.test.ts`;
- ledger num `mkdtemp` **separado**, fora do repo.

O CLI é chamado como `bun <ROOT>/bin/pinga.ts ...`.

1. `evaluateGuards({ task: "TX", touch: ["src/a.ts"], tests_frozen: ["tests/a.test.ts"], changed: ["src/a.ts"] })` → `{ ok: true }`.
2. `changed: ["tests/a.test.ts", "src/a.ts"]` → `tests_frozen_changed`, `exit: 5`, `files: ["tests/a.test.ts"]`.
3. `changed: ["src/b.ts", "src/a.ts", "README.md"]` → `scope_drift`, `exit: 6`, `files: ["README.md", "src/b.ts"]`.
4. `changed: ["tests/a.test.ts", "src/b.ts"]` → `tests_frozen_changed`, pela precedência.
5. `changed: ["tasks/TX/EXEC.md", "tasks/TX/EVAL.md"]` → ok. `["tasks/TY/EVAL.md"]` → `scope_drift`. `["tasks/TX/PLAN.md"]` → `scope_drift`.
6. Sem `touch` e sem `tests_frozen` → `{ ok: true }` para qualquer `changed`.
7. `alwaysAllowed("T04")` → `["tasks/T04/EXEC.md", "tasks/T04/EVAL.md"]`.
8. `precommitDecision`:
   - `["tests/a.test.ts"]` → `skip`;
   - `["tasks/T04/EXEC.md", "tasks/T04/EVAL.md"]` → `skip`;
   - `["specs/x.md"]` → `skip`;
   - `["src/a.ts", "tests/a.test.ts"]` → `test`;
   - `[]` → `test`.
9. `findRedBase` com commits, do mais antigo ao mais novo, `chore: init`, `test(TX): RED a`, `feat(TX): x`, `test(TX): RED b`, `test(TX1): RED c`:
   - `"TX"` → sha de `RED b`;
   - `"TZ"` → `null`;
   - repo sem commits → `null`.
10. `changedFiles` depois da base, com um commit que altera `src/a.ts`, `src/c.ts` modificado sem commit, `src/d.ts` apagado, `new.txt` untracked e `x.db` ignorado via `.gitignore` → exatamente `["new.txt", "src/a.ts", "src/c.ts", "src/d.ts"]`.
11. CLI, guardas ok: depois do RED, alterar e commitar só `src/a.ts` → exit 0, `pass`, `ran.flag` existe.
12. CLI, `tests_frozen` alterado: depois do RED, modificar `tests/a.test.ts` (sem commit) →
    - exit 5;
    - recibo `blocked`/`tests_frozen_changed`, `evidence: []`;
    - `summary` contém `tests/a.test.ts`;
    - `ran.flag` **não** existe, nem `runs/TX/1/out.txt`;
    - ledger com 1 linha; `validateReceipt` ok.
13. CLI, fora do touch: criar `src/extra.ts` untracked depois do RED → exit 6, `scope_drift`, `summary` contém `src/extra.ts`, `ran.flag` não existe.
14. CLI: criar e commitar `tasks/TX/EXEC.md` e `tasks/TX/EVAL.md` depois do RED → exit 0, `pass`.
15. CLI `--base`:
    - dois commits RED de TX, com `src/b.ts` commitado entre eles;
    - sem `--base` → exit 0 (a base é o RED mais recente);
    - `--base <sha do 1º RED>` → exit 6;
    - `--base nope` → exit 2, stderr contém `base inválida`, e o ledger continua com as linhas que já tinha;
    - `--base` sem valor → exit 2.
16. CLI sem commit RED (só o commit `chore: init`, mais `src/b.ts` untracked) → guardas puladas, exit 0, `pass`.
17. Integração: após 11–15, todo recibo impresso passa no `validateReceipt`, e `pinga ledger verify --ledger <tmp>` dá `ok <n>`.
18. `mise.toml` da raiz:
    - contém `pkl = "0.32.1"` na seção `[tools]`;
    - a seção `[tasks.pre-commit]` contém `pinga.ts precommit` e `bun test`.
19. CLI `precommit` num repo temporário com `cwd` = repo:
    - só `tests/a.test.ts` staged e `-- false` → exit 0, stdout contém `suíte pulada`;
    - `src/a.ts` staged e `-- false` → exit 1;
    - `src/a.ts` staged e `-- true` → exit 0.
