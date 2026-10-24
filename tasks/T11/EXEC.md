# EXEC T11 — Prova falha no base em git worktree temporária (I15)

Você é o **EXECUTOR** (`opencode/glm-5.3-flash-free`) da tarefa **T11** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T11/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T11/RED.md` e `specs/0002-p-inga-v0.1-rodada-3.md`
- **`done_when`:** `bun test tests/prove.test.ts` (e a suíte inteira `bun test` também deve passar no pre-commit).
- **`touch` permitido:** `["src/prove.ts", "src/verify.ts", "src/receipt.ts", "src/examples.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Zero dependências npm** (apenas Bun 1.4.4 built-ins: `Bun.spawn`, `Bun.spawnSync`, `node:fs`, `node:path`, `node:os`, `node:crypto` e `git worktree`). Não use `bunx tsc`.

## O que implementar

### 1. `src/receipt.ts`
- Adicione `"test_passed_on_base"` ao final de `REASON_CODES` (logo após `"overfit_holdout"`).
- Em `ReceiptV1`: adicione `base_ref?: string;` (e inclua `"base_ref"` em `ALLOWED_TOP_KEYS`).
- Em `validateReceipt`: se `base_ref !== undefined`, valide `typeof r.base_ref === "string" && /^[0-9a-f]{40}$/.test(r.base_ref)`; senão adicione erro em `errors`.
- Em `receiptKind`: já retorna `"prove_red"` se `r.flow === "prove_red"` (confira que está assim).

### 2. `src/examples.ts`
- Estenda `runHoldout` mantendo compatibilidade com T10:
  ```ts
  export function runHoldout(
    repoRoot: string,
    task: string,
    attempt: number | string,
    timeoutMs: number,
    opts?: { cwd?: string },
  ): HoldoutRun | null
  ```
  - O `storeFile = holdoutStorePath(repoRoot, task)` e o `repoKey = sha256hex(realpathSync(repoRoot)).slice(0, 16)` continuam usando `repoRoot`!
  - O diretório onde o runner é escrito e onde `bun test` roda é `const workDir = opts?.cwd ?? repoRoot;` (`runnerAbs = join(workDir, runnerRel)`, `importPath = relImportPath(dirname(runnerAbs), join(workDir, target.module))`, e `Bun.spawnSync(["bun", "test", \`./\${runnerRel}\`], { cwd: workDir, ... })`).
  - O artefato continua sendo gravado em `resolve(join(holdoutDir(), "runs", repoKey, task, \`\${attempt}.txt\`))` e o `runnerAbs` é sempre removido no `finally`.

### 3. `src/prove.ts`
Implemente e exporte toda a API de `tasks/T11/RED.md`:
- `export const PROVE_EXIT = { proved: 0, infra: 8, test_passed_on_base: 10 } as const;`
- `export const WORKTREE_PREFIX = "pinga-prove-";`
- `export type ProofVerdict = "proved" | "test_passed_on_base" | "inconclusive";`
- `classifyBaseRun(r: { exit: number | null; timedOut: boolean }): ProofVerdict`:
  - `if (r.timedOut || r.exit === null || r.exit === 126 || r.exit === 127) return "inconclusive";`
  - `if (r.exit === 0) return "test_passed_on_base";`
  - `return "proved";`
- `combineProof(doneWhen: ProofVerdict, holdout: ProofVerdict | null): { verdict: ProofVerdict; which: "done_when" | "holdout" | null }`:
  - Se `doneWhen === "test_passed_on_base"` -> `{ verdict: "test_passed_on_base", which: "done_when" }`
  - Se `holdout === "test_passed_on_base"` -> `{ verdict: "test_passed_on_base", which: "holdout" }`
  - Se `doneWhen === "inconclusive"` -> `{ verdict: "inconclusive", which: "done_when" }`
  - Se `holdout === "inconclusive"` -> `{ verdict: "inconclusive", which: "holdout" }`
  - Senão -> `{ verdict: "proved", which: null }`
- `resolveProofBase(repoRoot: string, task: string, base?: string): { ok: true; sha: string } | { ok: false; error: string }`:
  - Se `base !== undefined`: roda `git rev-parse --verify --quiet ${base}^{commit}` em `repoRoot`; se `exitCode !== 0` -> `{ ok: false, error: \`base inválida: \${base}\` }`, senão `{ ok: true, sha: stdout.trim() }`.
  - Se `base === undefined`: chama `findRedBase(repoRoot, task)`; se `null` -> `{ ok: false, error: \`sem base para \${task}\` }`, senão `{ ok: true, sha }`.
- `sweepStaleWorktrees(repoRoot: string): string[]`:
  - Roda `git worktree list --porcelain` em `repoRoot`.
  - Prefixo alvo: `const targetPrefix = join(realpathSync(tmpdir()), WORKTREE_PREFIX);`
  - Para cada bloco `worktree <wtPath>` (exceto a primeira worktree, que é a principal):
    - Se `wtPath.startsWith(targetPrefix)`:
      - Se `existsSync(wtPath)` (ou o diretório pai `dirname(wtPath)` que começa com `targetPrefix` existe):
        - Roda `git worktree remove --force <wtPath>` em `repoRoot`.
        - Remove o diretório pai `rmSync(dirname(wtPath), { recursive: true, force: true })` (se `dirname(wtPath).startsWith(targetPrefix)`).
        - Adiciona `wtPath` na lista de removidos.
  - Ao final, roda sempre `git worktree prune` em `repoRoot` (isso limpa registros cujos diretórios já tinham sumido).
  - Retorna os caminhos removidos ordenados lexicograficamente (`removed.sort()`).
- `withTempWorktree<T>(repoRoot: string, sha: string, fn: (path: string) => T): T`:
  - Cria `const parentDir = mkdtempSync(join(realpathSync(tmpdir()), WORKTREE_PREFIX));`
  - `const wtPath = join(parentDir, "wt");`
  - Registra handlers de `SIGINT` e `SIGTERM` temporários para limpeza de melhor esforço.
  - Roda `git worktree add --detach -q <wtPath> <sha>` em `repoRoot` (se falhar, limpa `parentDir` e lança erro).
  - Em `try { return fn(wtPath); } finally { ... }`:
    - Remove listeners de sinal.
    - Roda `git worktree remove --force <wtPath>` em `repoRoot`.
    - `rmSync(parentDir, { recursive: true, force: true })`.
    - Roda `git worktree prune` em `repoRoot`.
- `export type ProofResult = { verdict: ProofVerdict; which: "done_when" | "holdout" | null; base: string; evidence: Evidence[]; detail: string };`
- `proveBase(repoRoot: string, task: string, plan: Plan, sha: string, n: number | string, timeoutMs: number): ProofResult`:
  - Chama `sweepStaleWorktrees(repoRoot)` no início.
  - Dentro de `withTempWorktree(repoRoot, sha, (wtPath) => { ... })`:
    - **Overlay**: para cada `relPath` em `plan.tests_frozen`:
      - Se `existsSync(join(repoRoot, relPath))` na árvore de trabalho principal, copia para `join(wtPath, relPath)` (criando `dirname` com `mkdirSync(..., { recursive: true })`).
    - Verifica se `plan.tests_frozen[0]` existe em `wtPath` (`existsSync(join(wtPath, plan.tests_frozen[0]))`); se não existir:
      - Retorna `{ verdict: "inconclusive", which: "done_when", base: sha, evidence: [], detail: \`teste ausente no base (\${plan.tests_frozen[0]})\` }`.
    - Roda `sh -c <plan.done_when>` com `cwd: wtPath`, `timeout: timeoutMs`.
    - Grava a saída no repo **principal** em `runs/${task}/prove-${n}/out.txt` (`artifactRel = \`runs/\${task}/prove-\${n}/out.txt\``).
    - Monta `evidence[0]` com `cmd_sha256: sha256hex(plan.done_when)`, `exit: timedOut ? null : res.exitCode`, `duration_ms`, `artifact_ref: { path: artifactRel, sha256: outSha256 }`.
    - Classifica `dwVerdict = classifyBaseRun({ exit: timedOut ? null : res.exitCode, timedOut })`.
    - Roda `hRun = runHoldout(repoRoot, task, \`prove-\${n}\`, timeoutMs, { cwd: wtPath })`.
    - Se `hRun !== null`, adiciona `evidence[1]` e classifica `hoVerdict = classifyBaseRun({ exit: hRun.exit, timedOut: hRun.timedOut })`.
    - Combina `const comb = combineProof(dwVerdict, hoVerdict)`.
    - Calcula `detail` curto (<= 120 chars), ex: se `timedOut` -> `"timeout"`, senão `exit ${evidence[0].exit}`.
    - Retorna `{ verdict: comb.verdict, which: comb.which, base: sha, evidence, detail }`.
- `provePlan(planPath: string, opts?: { ledgerPath?: string; base?: string }): number`:
  - Lê e valida `planPath` com `parsePlan`; se falhar -> stderr, exit `3` (sem recibo).
  - Resolve `repoRoot` e `task`.
  - Chama `resolveProofBase(repoRoot, task, opts?.base)`; se `!ok` -> escreve `res.error` no stderr e retorna `2` (sem recibo).
  - Abre o ledger; `n = 1 + ledger.all().filter(r => r.task === task && receiptKind(JSON.parse(r.body)) === "prove_red").length`.
  - Calcula `timeoutMs` (respeitando `PINGA_TIMEOUT_MS` ou `plan.budget?.minutes`).
  - Chama `const proof = proveBase(repoRoot, task, plan, baseRes.sha, n, timeoutMs)`.
  - Monta o recibo com `flow: "prove_red"`, `base_ref: baseRes.sha`, `attempts: n`, `evidence: proof.evidence`, `tokens: NOT_RUN_TOKENS.tokens`, `cost_usd: null`, `cost_evidence: "not run"`, `author: authorFromEnv()`, `verified_by: null`:
    - `sha7 = baseRes.sha.slice(0, 7)`
    - Se `proof.verdict === "proved"`:
      - `status = "pass"`, `reason_code = null`, `exit = 0`, `summary = \`\${task} pass: RED falha no base \${sha7} (done_when exit \${proof.evidence[0]?.exit})\`.slice(0, 280)`
    - Se `proof.verdict === "test_passed_on_base"`:
      - `status = "blocked"`, `reason_code = "test_passed_on_base"`, `exit = 10`, `next_action = "reescrever o RED"`, `summary = \`\${task} blocked: \${proof.which} passa no base \${sha7}; o teste não prova nada novo\`.slice(0, 280)`
    - Se `proof.verdict === "inconclusive"`:
      - `status = "not run"`, `reason_code = "infra"`, `exit = 8`, `summary = \`\${task} not run: prova inconclusiva no base \${sha7} (\${proof.detail})\`.slice(0, 280)`
  - Grava no ledger, imprime no stdout e retorna o `exit`.

### 4. `src/verify.ts`
- Estenda `VerifyOptions`:
  `export type VerifyOptions = { base?: string; usageFile?: string; overrideMode?: string; reason?: string; proveBase?: boolean };`
- Ordem no `verifyPlan`:
  1. Validações de flags (`--base`, `--override-mode`/`--reason`, `--usage-file`) que saem com exit 2 antes de gravar recibo:
     - Adicione também: se `opts?.proveBase === true`, precisamos de `baseSha` (`resolvedBase ?? findRedBase(repoRoot, task)`). Se `opts?.proveBase === true` e `baseSha === null` (depois de ler que o plano é válido, ou antes de gravar qualquer recibo): escreva `"sem base"` no stderr e retorne `2` **sem** gravar recibo!
  2. Plano inválido -> exit 3 (`plan_invalid`).
  3. Calcula `modeDecision` (T09) e roda guardas (`tests_frozen_changed` exit 5, `scope_drift` exit 6).
  4. **Prova no base** (antes de rodar o `done_when` no repo principal):
     - Deve rodar se `modeDecision.effective === "completo" || opts?.proveBase === true`.
     - Se deve rodar:
       - Se `baseSha === null` (caso `completo` sem `--prove-base` e sem commit RED):
         - Escreve `"prova no base pulada: sem commit RED"` no stderr e segue normalmente para o `done_when` (sem `base_ref`).
       - Se `baseSha !== null`:
         - Roda `const proof = proveBase(repoRoot, task, plan, baseSha, attempt, timeoutMs);` (onde `prove-${attempt}` será usado para os artefatos porque `n = attempt`).
         - Se `proof.verdict !== "proved"`:
           - Gera recibo `verify` (NÃO coloque `flow: "prove_red"`!) com `base_ref: baseSha`, campos de modo (`mode_effective`, `mode_raised_by`, `mode_override`), `evidence: proof.evidence`, status/reason_code/summary/next_action da tabela do item 7 de `RED.md`, grava no ledger, imprime no stdout e retorna o exit (`10` para `test_passed_on_base`, `8` para `inconclusive`). O `done_when` **não** roda no repo principal!
         - Se `proof.verdict === "proved"`:
           - Guarda `provedBaseRef = baseSha` e segue para rodar o `done_when` no repo principal; o recibo final do `verify` ganha `base_ref: provedBaseRef`.

### 5. `src/cli.ts`
- Adicione o subcomando `prove-red`:
  `pinga prove-red <PLAN.md> [--ledger PATH] [--base SHA]`
  - Sem plano, flag desconhecida ou flag sem valor -> stderr e exit `2`.
- Em `pinga verify`, aceite a flag booleana `--prove-base` (passando `proveBase: true` para `verifyPlan`).
- Atualize `USAGE` com a linha do `prove-red` e `[--prove-base]` no `verify`.

## Regras de Git e Finalização
1. Rode `bun test tests/prove.test.ts` e `bun test` até que **todos** os testes passem.
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` (`src/prove.ts`, `src/verify.ts`, `src/receipt.ts`, `src/examples.ts`, `src/cli.ts`) foi modificado.
3. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add src/prove.ts src/verify.ts src/receipt.ts src/examples.ts src/cli.ts
   git commit -m "feat(T11): prova falha no base em git worktree temporária (I15)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN.
