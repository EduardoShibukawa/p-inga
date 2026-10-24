Você é o EXECUTOR da T04 (opencode opencode/glm-5.3-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `1754587` (`test(T04): RED guardas de escopo, tests_frozen e precommit`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/guards.ts", "src/verify.ts", "src/cli.ts", "mise.toml"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- Nunca `git add .`/`-A`: sempre caminhos explícitos. Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Nunca rode `bunx tsc`. Só built-ins do Bun 1.4.4.
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T04/EXEC.md` no commit.

== 2. CONTRATO DA T04 ==
Leia `tasks/T04/PLAN.md`, `tasks/T04/RED.md`, `src/verify.ts`, `src/cli.ts`, `mise.toml` e `tests/guards.test.ts` inteiros.

Implemente:
1. `src/guards.ts`:
   - `GUARD_EXIT = { tests_frozen_changed: 5, scope_drift: 6 } as const;`
   - `alwaysAllowed(task: string): string[]` → `[`tasks/${task}/EXEC.md`, `tasks/${task}/EVAL.md`]`
   - `evaluateGuards(input: GuardInput): GuardResult`:
     - Se `input.tests_frozen` estiver presente, cheque `files = input.changed.filter(f => input.tests_frozen!.includes(f)).sort()`. Se `files.length > 0`, retorne `{ ok: false, reason_code: "tests_frozen_changed", files, exit: 5 }`.
     - Senão, se `input.touch` estiver presente, `allowed = new Set([...input.touch, ...alwaysAllowed(input.task)])`; `files = input.changed.filter(f => !allowed.has(f)).sort()`. Se `files.length > 0`, retorne `{ ok: false, reason_code: "scope_drift", files, exit: 6 }`.
     - Senão, retorne `{ ok: true }`.
   - `findRedBase(repoRoot: string, task: string): string | null`:
     - Roda `git log --format=%H%x09%s` em `repoRoot`. Se `exitCode !== 0`, retorna `null`.
     - Procura a primeira linha cujo assunto (`subject`) comece exatamente com `test(${task}): RED` e retorna o SHA (40 hex), ou `null`.
   - `changedFiles(repoRoot: string, base: string): string[]`:
     - `git diff --name-only --no-renames ${base}` em `repoRoot`
     - União com `git ls-files --others --exclude-standard` em `repoRoot`
     - Retorna array único e ordenado lexicograficamente (`Array.from(set).sort()`).
   - `precommitDecision(staged: string[]): "skip" | "test"`:
     - Retorna `"skip"` se `staged.length > 0` e todo caminho começa com `"tests/"`, `"tasks/"` ou `"specs/"`; caso contrário `"test"`.

2. `src/verify.ts`:
   - Estenda `verifyPlan(planPath, ledgerPathArg?, attemptArg?, opts?: VerifyOptions): number` com `export type VerifyOptions = { base?: string }`.
   - Descubra `repoRoot` via `git rev-parse --show-toplevel` (como já faz).
   - **Se `opts?.base !== undefined`**: valide com `git rev-parse --verify --quiet ${opts.base}^{commit}` em `repoRoot`. Se `exitCode !== 0`, escreva `console.error(\`base inválida: \${opts.base}\`)` e retorne `2` **ANTES** de gravar qualquer recibo no ledger!
   - Após o lint do plano (`parsePlan`), resolva `baseSha = resolvedBase ?? findRedBase(repoRoot, task)`.
   - Se `baseSha !== null`:
     - `const changed = changedFiles(repoRoot, baseSha);`
     - `const guardRes = evaluateGuards({ task, touch: plan.touch, tests_frozen: plan.tests_frozen, changed });`
     - Se `!guardRes.ok`:
       - NÃO rode `done_when`.
       - Monte recibo com `status: "blocked"`, `reason_code: guardRes.reason_code`, `evidence: []`, `tokens: { in: null, out: null, cache: null, source: null }`, `cost_usd: null`, `cost_evidence: "not run"`, `summary` igual a:
         - se `tests_frozen_changed`: `` `${task} blocked: tests_frozen alterado (${guardRes.files.join(", ")})` ``.slice(0, 280)
         - se `scope_drift`: `` `${task} blocked: fora do touch (${guardRes.files.join(", ")})` ``.slice(0, 280)
       - Grave no ledger, imprima `JSON.stringify(receipt)` no stdout e retorne `guardRes.exit` (5 ou 6).

3. `src/cli.ts`:
   - Em `verify`: suporte `--base <SHA>` (se faltar valor ou começar com `--`, exit 2) e passe `{ base }` para `verifyPlan`.
   - Adicione comando `precommit`: `pinga precommit [-- <cmd...>]` (default cmd: `["bun", "test"]`):
     - Rode `git diff --cached --name-only` no `process.cwd()`.
     - Se `precommitDecision(staged) === "skip"`, imprima `precommit: só tests/, tasks/ e specs/ staged; suíte pulada` no stdout e retorne `0`.
     - Se `"test"`, rode `Bun.spawnSync(cmd, { cwd: process.cwd(), stdio: ["inherit", "inherit", "inherit"] })` e retorne `res.exitCode ?? 1`.

4. `mise.toml`:
   - Adicione `pkl = "0.32.1"` em `[tools]`.
   - Mude `[tasks.pre-commit]` para `run = "bun bin/pinga.ts precommit -- bun test"`.

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato: `bun test tests/guards.test.ts`
2. Rode a suíte inteira: `bun test`
3. Confirme que `tests_frozen` não mudou:
   `git diff 1754587..HEAD -- tests/guards.test.ts tests/verify.test.ts tests/ledger.test.ts tests/receipt.test.ts tests/repo.test.ts`
4. Commit GREEN:
   ```bash
   git add src/guards.ts src/verify.ts src/cli.ts mise.toml
   mise exec pkl@0.32.1 -- git commit -m "feat(T04): guardas I5 (tests_frozen e scope_drift) e pinga precommit" -m "Co-Authored-By: glm-5.3-flash-free <noreply@zhipuai.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Cole a saída de `bun test tests/guards.test.ts`, `bun test`, o sha do commit GREEN e `git diff --stat 1754587..HEAD`. Depois PARE.
