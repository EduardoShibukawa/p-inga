Você é o EXECUTOR da T03 (opencode opencode/glm-5.3-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `ddfa398` (`test(T03): RED parsePlan, pinga verify e scripts/stable.ts`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/plan.ts", "src/verify.ts", "src/cli.ts", "scripts/stable.ts", "mise.toml"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
  E também não edite `src/receipt.ts`, `src/canonical.ts`, `src/ledger.ts` ou `bin/pinga.ts`.
- Nunca `git add .`/`-A`: sempre caminhos explícitos. Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Só built-ins do Bun 1.4.4 (`Bun.YAML.parse`, `Bun.spawnSync`, `node:crypto`, `node:fs`, `node:path`).
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas. Não tente uma terceira vez.
- Não declare "passou" sem colar a saída real do `done_when`. Status só em `pass`, `fail`, `blocked` ou `not run`.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T03/EXEC.md` no commit.

== 2. CONTRATO DA T03 ==
Leia `tasks/T03/PLAN.md`, `tasks/T03/RED.md`, `src/receipt.ts`, `src/ledger.ts`, `src/cli.ts` e `tests/verify.test.ts` inteiros.

### Assinaturas do Bun 1.4.4 usadas nesta task:
```ts
// 1. YAML parser nativo do Bun 1.4.4:
const parsed = Bun.YAML.parse(yamlString);

// 2. Spawn síncrono com timeout:
const res = Bun.spawnSync(["sh", "-c", doneWhen], {
  cwd: repoRoot,
  timeout: timeoutMs,
  stdout: "pipe",
  stderr: "pipe",
});
// Se estourou timeout: res.exitedDueToTimeout === true (ou res.signalCode !== null / res.exitCode === null)
// Caso contrário: res.exitCode é um inteiro (0, 1, 7, etc.)
// res.stdout e res.stderr são Uint8Array / Buffer
```

### 1. `src/plan.ts`
```ts
export type Plan = {
  mode: "mvp" | "padrao" | "completo";
  goal: string;
  done_when: string;
  touch?: string[];
  tests_frozen?: string[];
  budget?: { tokens?: number; minutes?: number };
};
export function parsePlan(text: string):
  | { ok: true; plan: Plan }
  | { ok: false; errors: string[] };
```
Regras de `parsePlan(text)`:
- Ignorando uma única quebra de linha final (`text.replace(/\r?\n$/, "").split(/\r?\n/)`), o plano pode ter no máximo 25 linhas (`lines.length <= 25`). Se `> 25`, adicione erro (ex.: `"plan exceeds 25 lines"`).
- Frontmatter entre linhas `---` (a primeira linha tem de ser `---` e precisa haver outra linha `---` fechando). Parseie o conteúdo entre elas com `Bun.YAML.parse(frontmatterText)`.
- Valide os campos do objeto YAML (acumulando erros em `errors: string[]`):
  - `mode`: deve ser `"mvp"`, `"padrao"` ou `"completo"`.
  - `goal`: `typeof goal === "string" && goal.length > 0 && goal.length <= 280`.
  - `done_when`: `typeof done_when === "string" && done_when.trim().length > 0`.
  - `touch`: se `mode === "padrao" || mode === "completo"`, `touch` é obrigatório e deve ser `string[]` (array de strings não vazias); em `"mvp"` é opcional, mas se presente deve ser `string[]`.
  - `tests_frozen`: opcional; se presente, `string[]`.
  - `budget`: opcional; se presente, objeto com `tokens?` (inteiro > 0) e `minutes?` (`typeof minutes === "number" && minutes > 0`).

### 2. `src/verify.ts`
Implemente a verificação de um `<PLAN.md>`:
- **Id da task:** nome da pasta pai do arquivo de plano (`basename(dirname(resolve(planPath)))`, ex.: `tasks/T01/PLAN.md` → `T01`).
- **Tentativa (`attempts`):** se `--attempt N` foi passado no CLI, use `N` (inteiro >= 1); caso contrário, `1 +` quantidade de recibos existentes no ledger com `row.task === task`.
- **Lint do plano:** leia o arquivo `planPath` e chame `parsePlan(text)`.
  - Se `!parsed.ok`:
    - Monte recibo com `status: "blocked"`, `reason_code: "plan_invalid"`, `evidence: []`, `summary: `${task} blocked: plano inválido (${parsed.errors[0]})`.slice(0, 280)`.
    - Grave no ledger (`ledger.append(receipt)`), imprima `JSON.stringify(receipt)` no stdout e retorne exit code `3`.
- **Execução do `done_when`** (quando `parsed.ok === true`):
  - Descubra a raiz do repo git do plano rodando `Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd: dirname(resolve(planPath)) })`. (Se falhar, fallback para `dirname(resolve(planPath))`).
  - `timeoutMs`: `process.env.PINGA_TIMEOUT_MS ? Number(process.env.PINGA_TIMEOUT_MS) : (plan.budget?.minutes ? plan.budget.minutes * 60_000 : 30 * 60_000)`.
  - Meça `t0 = Date.now()`, rode `Bun.spawnSync(["sh", "-c", plan.done_when], { cwd: repoRoot, timeout: timeoutMs })`, `duration_ms = Math.max(0, Date.now() - t0)`.
  - Salve `stdout + stderr` combinados (`Buffer.concat([res.stdout, res.stderr])`) em `join(repoRoot, "runs", task, String(attempt), "out.txt")` (criando os diretórios com `mkdirSync(..., { recursive: true })`).
  - Calcule `outSha256 = sha256hex(outBuffer)` e `cmdSha256 = sha256hex(plan.done_when)`.
  - Determine `timedOut = Boolean(res.exitedDueToTimeout || res.exitCode === null)`.
  - Tabela de status/reason_code/exit:
    - Se `timedOut`: `status = "blocked"`, `reason_code = "budget"`, `evidenceExit = null`, `cliExit = 2`.
    - Senão se `res.exitCode === 0`: `status = "pass"`, `reason_code = null`, `evidenceExit = 0`, `cliExit = 0`.
    - Senão: `status = "fail"`, `reason_code = "command_failed"`, `evidenceExit = res.exitCode`, `cliExit = 1`.
  - Segundos para o summary: `const segundos = Math.round(duration_ms / 1000)` (ou `(duration_ms / 1000).toFixed(1)`).
  - `summary = `${task} ${status}: done_when exit ${evidenceExit} em ${segundos}s`.slice(0, 280)`.
  - Campos fixos do recibo:
    - `v: 1`, `type: "task.receipt"`, `id: randomUUID()` (ou `${task}-${attempt}-${Date.now()}`), `task`, `status`, `reason_code`, `attempts: attempt`,
    - `evidence: [{ kind: "command", cmd_sha256: cmdSha256, exit: evidenceExit, duration_ms, artifact_ref: { path: `runs/${task}/${attempt}/out.txt`, sha256: outSha256 } }]`,
    - `tokens: { in: null, out: null, cache: null, source: null }`,
    - `cost_usd: null`, `cost_evidence: "not run"`,
    - `author: { model: process.env.PINGA_AUTHOR_MODEL ?? null, family: process.env.PINGA_AUTHOR_FAMILY ?? null }`,
    - `verified_by: null`,
    - `summary`, `created_at: new Date().toISOString()`.
  - Grave no ledger (`ledger.append(receipt)`), imprima `JSON.stringify(receipt)` no stdout e retorne `cliExit`.

### 3. `src/cli.ts`
Mantenha `ledger verify [--ledger PATH]` da T02 e adicione:
`pinga verify <PLAN.md> [--ledger PATH] [--attempt N]`

### 4. `scripts/stable.ts` e `mise.toml`
- `scripts/stable.ts`:
  - Checa `git status --porcelain` no `process.cwd()`. Se `stdout.toString().trim() !== ""` (ou exitCode !== 0), escreve `"árvore suja\n"` no **stderr** (`console.error("árvore suja")`) e sai com exit code `1`.
  - Senão:
    - Cria `.pinga/` se não existir (`mkdirSync(".pinga", { recursive: true })`).
    - Roda `bun build --compile bin/pinga.ts --outfile .pinga/pinga-stable`. Se falhar, sai com 1.
    - Obtém commit atual (`git rev-parse HEAD`) e grava `.pinga/stable.json` com `JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2)`.
- `mise.toml`:
  - Mantenha `[tools]` (`bun = "1.4.4"`, `hk = "1.24.0"`) e `[tasks.pre-commit]` (`run = "bun test"`).
  - Adicione:
    ```toml
    [tasks.stable]
    run = "bun scripts/stable.ts"
    ```

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato:
   `bun test tests/verify.test.ts`
2. Rode a suíte inteira:
   `bun test`
3. Confirme que os testes congelados não mudaram:
   `git diff ddfa398..HEAD -- tests/verify.test.ts tests/ledger.test.ts tests/receipt.test.ts tests/repo.test.ts` (vazio)
4. Faça o commit GREEN:
   ```bash
   git add src/plan.ts src/verify.ts src/cli.ts scripts/stable.ts mise.toml
   mise exec pkl@0.32.1 -- git commit -m "feat(T03): pinga verify e build do pinga-stable" -m "Co-Authored-By: glm-5.3-flash-free <noreply@zhipuai.com>"
   ```
   (Nota: NÃO rode `mise run stable` nem os recibos retroativos ainda se `tasks/T03/EXEC.md` estiver untracked, pois `stable.ts` exige árvore limpa; o planejador rodará `mise run stable` e os recibos retroativos logo após commitar `EXEC.md` e `EVAL.md`.)

== 4. FIM OBRIGATÓRIO ==
Ao terminar, cole na sua resposta final:
1. A saída real de `bun test tests/verify.test.ts` e `bun test`
2. O sha do commit GREEN (`git rev-parse --short HEAD`)
3. A saída de `git diff --stat ddfa398..HEAD`
Depois PARE imediatamente.
