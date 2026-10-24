# RED T11 — tests/prove.test.ts (+ `tests/receipt.test.ts`)

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.spawn`, `Bun.spawnSync`, `node:fs`, `node:path`, `node:os`, `node:crypto`) e `git worktree`. Zero dependências npm (D4). Todo caso usa repos em `mkdtemp`, ledger fora do repo e `PINGA_HOLDOUT_DIR=<mkdtemp>`.

O commit RED também altera `tests/receipt.test.ts`: a expectativa de `REASON_CODES` ganha `"test_passed_on_base"` no fim (SPEC 0002 §4.1).

## API esperada

```ts
// src/prove.ts
export const PROVE_EXIT = { proved: 0, infra: 8, test_passed_on_base: 10 } as const;
export const WORKTREE_PREFIX = "pinga-prove-";            // mkdtemp(join(realpath(tmpdir()), WORKTREE_PREFIX))
export type ProofVerdict = "proved" | "test_passed_on_base" | "inconclusive";

export function classifyBaseRun(r: { exit: number | null; timedOut: boolean }): ProofVerdict;
export function combineProof(doneWhen: ProofVerdict, holdout: ProofVerdict | null):
  { verdict: ProofVerdict; which: "done_when" | "holdout" | null };
export function resolveProofBase(repoRoot: string, task: string, base?: string):
  | { ok: true; sha: string }                              // 40 hex
  | { ok: false; error: string };
export function withTempWorktree<T>(repoRoot: string, sha: string, fn: (path: string) => T): T;
export function sweepStaleWorktrees(repoRoot: string): string[];   // caminhos removidos, ordenados
export type ProofResult = {
  verdict: ProofVerdict;
  which: "done_when" | "holdout" | null;
  base: string;                                            // sha
  evidence: Evidence[];                                    // 1 ou 2 itens
  detail: string;                                          // motivo curto (≤ 120)
};
export function proveBase(repoRoot: string, task: string, plan: Plan, sha: string, n: number, timeoutMs: number): ProofResult;
export function provePlan(planPath: string, opts?: { ledgerPath?: string; base?: string }): number;

// src/examples.ts (T10, estendida e compatível)
export function runHoldout(
  repoRoot: string, task: string, attempt: number | string, timeoutMs: number, opts?: { cwd?: string },
): HoldoutRun | null;                                      // store pela chave de repoRoot; roda em opts.cwd ?? repoRoot

// src/receipt.ts
//   REASON_CODES += "test_passed_on_base" (no fim)
//   Receipt.base_ref?: string (40 hex minúsculo)
//   receiptKind: flow === "prove_red" → "prove_red"

// src/verify.ts
export type VerifyOptions = {
  base?: string; usageFile?: string; overrideMode?: string; reason?: string; proveBase?: boolean;
};
```

## Comportamento esperado

1. **`classifyBaseRun`:** `exit 0` → `test_passed_on_base`; `timedOut`, `exit null`, `126` ou `127` → `inconclusive`; qualquer outro exit → `proved`.
2. **`combineProof`:** `test_passed_on_base` em qualquer lado vence (`done_when` antes de `holdout`); senão `inconclusive` em qualquer lado vence; senão `proved`. `which` aponta o conjunto decisivo; `proved` → `which: null`.
3. **`resolveProofBase`:** `base` dado → `git rev-parse --verify --quiet <base>^{commit}` (inválida → `error` contém `base inválida`); senão `findRedBase` (T04); nenhuma → `error` contém `sem base`.
4. **Worktree temporária (`withTempWorktree`):**
   - diretório `mkdtemp(join(realpath(tmpdir()), "pinga-prove-"))`; `git worktree add --detach -q <dir>/wt <sha>`;
   - `fn(<dir>/wt)` roda; no `finally`, **sempre**: `git worktree remove --force <dir>/wt`, `rmSync(<dir>, { recursive: true, force: true })` e `git worktree prune`;
   - exceção dentro de `fn` é relançada **depois** da limpeza;
   - melhor esforço contra sinais: `SIGINT`/`SIGTERM` durante a prova limpam e saem com 130/143. A garantia contra `SIGKILL` é a varredura (item 5).
5. **`sweepStaleWorktrees(repoRoot)`**, chamado no início de toda prova:
   - lê `git worktree list --porcelain`;
   - remove (como no item 4) **só** worktrees registradas neste repo cujo caminho começa com `join(realpath(tmpdir()), "pinga-prove-")`;
   - registro cujo diretório já sumiu → `git worktree prune`;
   - nunca toca na worktree principal nem em outras worktrees.
6. **`proveBase`** dentro da worktree no `sha`:
   - **overlay**: cada arquivo de `plan.tests_frozen` que existe na árvore de trabalho do repo principal é copiado por cima na worktree. No commit RED isso não muda nada (a T04 garante que `tests_frozen` não mudou desde o RED); num `--base` anterior ao RED, isso monta "código do base + teste do contrato";
   - `plan.tests_frozen[0]` (o teste da própria task, por convenção) ausente na worktree depois do overlay → `inconclusive`, `detail` contém `teste ausente no base`, sem rodar nada;
   - roda `sh -c <done_when>` com `cwd` = worktree e o timeout dado; saída gravada no repo **principal**, em `runs/<task>/prove-<n>/out.txt`;
   - se existe holdout da T10 para `(repoRoot, task)`, roda também `runHoldout(repoRoot, task, "prove-<n>", timeoutMs, { cwd: <worktree> })`;
   - veredito = `combineProof(classify(done_when), holdout ? classify(holdout) : null)`;
   - `evidence[0]` = o `done_when` (`artifact_ref` relativo ao repo principal); `evidence[1]` = o holdout, se rodou (`artifact_ref` absoluto, fora da worktree, como na T10).
   - O repo principal **não muda**: `git status --porcelain` e os bytes dos arquivos sujos são os mesmos antes e depois (fora `runs/`, que é ignorado).
7. **`pinga prove-red <PLAN.md> [--ledger PATH] [--base SHA]`:**
   - plano inválido → exit 3; `resolveProofBase` com erro → stderr, exit 2; nos dois casos, **sem** recibo;
   - `n` = 1 + recibos `prove_red` da task no ledger;
   - recibo `flow: "prove_red"`, `base_ref: <sha>`, `attempts: n`, `author` do env (como no verify), `verified_by: null`, `NOT_RUN_TOKENS`:

     | Veredito | status / reason_code | exit | `summary` (cortado em 280) |
     |---|---|---|---|
     | `proved` | `pass` / `null` | 0 | `` `${task} pass: RED falha no base ${sha7} (done_when exit ${exit})` `` |
     | `test_passed_on_base` | `blocked` / `test_passed_on_base` | 10 | `` `${task} blocked: ${which} passa no base ${sha7}; o teste não prova nada novo` `` |
     | `inconclusive` | `not run` / `infra` | 8 | `` `${task} not run: prova inconclusiva no base ${sha7} (${detail})` `` |

     `sha7` = 7 primeiros caracteres; no bloqueio, `next_action: "reescrever o RED"`.
8. **Integração no `verify`** (ordem: lint → guardas → **prova** → `done_when` → holdout):
   - a prova roda se `mode_effective === "completo"` (T09) **ou** com `--prove-base`;
   - base = a mesma das guardas (`--base` ou `findRedBase`). Sem base: com `--prove-base` → stderr `sem base`, exit 2, sem recibo; em `completo` sem `--prove-base` → stderr `prova no base pulada: sem commit RED`, e o verify segue como na T09;
   - `n` da prova = `prove-<attempt>`;
   - prova `proved` → segue normalmente, e o recibo final ganha `base_ref`;
   - prova não `proved` → recibo `verify` (sem `flow: "prove_red"`) com o status, o `reason_code` e o exit da tabela do item 7, `base_ref`, campos de modo da T09 e `evidence` da prova. O `done_when` **não** roda no repo principal (sem `runs/<task>/<attempt>/out.txt`).
9. **Consumidores:** `receiptKind` devolve `prove_red` para `flow: "prove_red"`; por isso `evalPlan` e `lastReceiptFor` já os ignoram (T08).
10. **`validateReceipt`:** `base_ref` presente tem de casar `^[0-9a-f]{40}$`.
11. **CLI:** `pinga prove-red <PLAN.md> [--ledger PATH] [--base SHA]` e `pinga verify ... [--prove-base]`. Sem plano, flag desconhecida ou flag sem valor → exit 2. A `USAGE` ganha a linha do `prove-red`.

## Casos

Unitários:

1. `classifyBaseRun`: `{0,false}` → `test_passed_on_base`; `{1,false}` e `{7,false}` → `proved`; `{126,false}`, `{127,false}`, `{null,false}`, `{1,true}` → `inconclusive`.
2. `combineProof`:

   | done_when | holdout | verdict | which |
   |---|---|---|---|
   | proved | `null` | proved | `null` |
   | proved | proved | proved | `null` |
   | proved | test_passed_on_base | test_passed_on_base | holdout |
   | test_passed_on_base | proved | test_passed_on_base | done_when |
   | test_passed_on_base | inconclusive | test_passed_on_base | done_when |
   | inconclusive | proved | inconclusive | done_when |
   | proved | inconclusive | inconclusive | holdout |

3. `receiptKind({ flow: "prove_red" })` → `prove_red`. `validateReceipt` aceita `base_ref` de 40 hex e rejeita `"abc"`, 64 hex e maiúsculas.

Repo padrão (`R`): `git init -q -b main`, `git checkout -q -b feat/x`; commit `chore: init` com `.gitignore` (`runs/`, `.pinga/`, `*.db`, `ran.flag`), `tasks/TX/PLAN.md` (`done_when: "bun test tests/a.test.ts"`, `touch: ["src/a.ts"]`, `tests_frozen: ["tests/a.test.ts"]`) e `src/a.ts` com `export const f = () => 1;`; commit `test(TX): RED` com `tests/a.test.ts` exigindo `f() === 2`. O CLI é chamado como `bun <ROOT>/bin/pinga.ts ...`.

4. `resolveProofBase(R, "TX")` → sha do RED. Sem commit RED → `sem base`. `"nope"` → `base inválida`.
5. `withTempWorktree(R, <sha RED>, fn)`:
   - dentro de `fn`: o caminho existe, começa com `realpath(tmpdir())/pinga-prove-`, e `git rev-parse HEAD` nele é o sha;
   - depois: o diretório não existe e `git worktree list --porcelain` só tem a worktree principal;
   - `fn` que lança `Error("x")` → `withTempWorktree` relança `x`, e a limpeza acontece igual.
6. `sweepStaleWorktrees`:
   - uma worktree criada à mão em `mkdtemp(realpath(tmpdir())/pinga-prove-)` → removida e devolvida;
   - uma worktree em `mkdtemp(tmpdir()/outra-)` → intacta;
   - uma `pinga-prove-` registrada cujo diretório foi apagado → some do `git worktree list`.

CLI `prove-red`:

7. Prova ok em `R` → exit 0; recibo `flow: "prove_red"`, `pass`, `base_ref` = sha do RED, `attempts: 1`, `evidence[0].exit !== 0`; `runs/TX/prove-1/out.txt` existe no repo principal e bate com o `artifact_ref`; nenhuma worktree `pinga-prove-` sobra.
8. Árvore suja no principal: `src/a.ts` alterado para `() => 2` (sem commit) e `src/b.ts` untracked → exit 0 (a worktree usa o base, não a árvore de trabalho). `git status --porcelain` e o conteúdo de `src/a.ts` iguais antes e depois.
9. RED tautológico: o RED exige `expect(1).toBe(1)` → exit 10, `blocked`/`test_passed_on_base`, `summary` contém `done_when passa no base`, `next_action: "reescrever o RED"`, sem worktree sobrando.
10. Implementação já no base: `src/a.ts` já devolve 2 no `chore: init` → exit 10.
11. Inconclusivo:
    - `done_when: "comando-inexistente-xyz"` → exit 8, `not run`/`infra`;
    - `done_when: "sleep 5"` com `PINGA_TIMEOUT_MS=200` → exit 8;
    - nos dois, sem worktree sobrando.
12. `--base <sha do chore: init>` (o teste ainda não existe nesse commit): o overlay traz `tests/a.test.ts` da árvore de trabalho → exit 0, `base_ref` = sha do init. Com `tests/a.test.ts` também apagado da árvore de trabalho → exit 8, `summary` contém `teste ausente no base`.
13. `--base nope` → exit 2, stderr `base inválida`. Sem RED e sem `--base` → exit 2, stderr `sem base`. Nos dois, o ledger mantém o número de linhas.
14. Holdout no base (fixture `F5` da T10, alvo `src/double.ts`): `pinga examples` roda antes do RED e o commit RED leva `tests/examples/TX.test.ts`; o plano usa `done_when: "bun test tests/examples/TX.test.ts"` e `tests_frozen: ["tests/examples/TX.test.ts"]`:
    - base com `double = () => 0` → visível e holdout falham → exit 0, `evidence.length === 2`;
    - base com `double` que só acerta o exemplo do holdout (tabela montada de `partitionExamples(F5, "TX").holdout`) → visível falha, holdout passa → exit 10, `summary` contém `holdout passa no base`.
15. Limpeza depois de `SIGKILL`: `prove-red` com `done_when: "sleep 30"` via `Bun.spawn`; quando uma worktree `pinga-prove-` aparece no `git worktree list --porcelain` (espera ≤ 5 s), `proc.kill("SIGKILL")`. Depois, um `prove-red` normal → exit 0, e nem a worktree morta nem o diretório dela existem.

Integração no `verify` (repo `R`, ledger temporário):

16. Plano com `touch: ["src/a.ts", "src/auth/a.ts"]` (vira `completo`) e RED tautológico → `verify` exit 10, `blocked`/`test_passed_on_base`, `mode_effective: "completo"`, `base_ref` presente, sem `flow`, e `runs/TX/1/out.txt` **não** existe.
17. Mesmo plano, RED válido, GREEN aplicado (`src/a.ts` → `() => 2`, commitado) → exit 0, `pass`, `base_ref` = sha do RED, `flow: "awaiting_judge"`.
18. Plano `padrao` sem sinais e RED tautológico: sem `--prove-base` → exit 0, sem `base_ref`; com `--prove-base` → exit 10.
19. Plano `completo` sem commit RED → stderr contém `prova no base pulada`, exit e recibo como na T09.
20. Consumidores: no mesmo ledger, `verify` de um plano com `done_when: "exit 7"` (exit 1), `prove-red` do mesmo plano (exit 0: `exit 7` falha no base) e de novo o mesmo `verify` → o 2º `verify` arma o disjuntor (exit 4), porque o recibo `prove_red` no meio é ignorado. `eval` depois de `prove-red` + `verify` `pass` → `tentativas 1`.
21. CLI: `prove-red` sem plano → exit 2; `--base` sem valor → exit 2; `--xpto` → exit 2.
22. Integração: todo recibo impresso nos casos 7–20 passa no `validateReceipt`, e `pinga ledger verify --ledger <tmp>` dá `ok <n>`.
