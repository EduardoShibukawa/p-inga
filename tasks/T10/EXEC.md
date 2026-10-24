# EXEC T10 — Examples sem LLM e holdout reservado (I13 / I14)

Você é o **EXECUTOR** (`opencode/glm-5.3-flash-free`) da tarefa **T10** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T10/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T10/RED.md` e `specs/0002-p-inga-v0.1-rodada-3.md`
- **`done_when`:** `bun test tests/examples.test.ts` (e a suíte inteira `bun test` também deve passar no pre-commit).
- **`touch` permitido:** `["src/examples.ts", "src/verify.ts", "src/receipt.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Zero dependências npm** (apenas Bun 1.4.4 built-ins: `Bun.YAML`, `Bun.spawnSync`, `node:crypto`, `node:fs`, `node:path`, `node:os`). Não use `bunx tsc`.

## O que implementar

### 1. `src/receipt.ts`
- Adicione `"overfit_holdout"` ao final de `REASON_CODES` (logo após `"model_unattested"`).

### 2. `src/examples.ts`
Implemente e exporte toda a API especificada em `tasks/T10/RED.md`:
- `export const OVERFIT_EXIT = 9;`
- `export const GENERATED_HEADER = "// gerado por pinga examples (T10): não editar";`
- `export type Example = { name: string; input: unknown[]; output: unknown };`
- `export type ExamplesSpec = { target: { module: string; export: string }; holdout: number; seed: string; examples: Example[] };`
- `parseExamples(text: string, format: "json" | "yaml"): { ok: true; spec: ExamplesSpec } | { ok: false; errors: string[] }`:
  - Faz parse via `format === "yaml" ? Bun.YAML.parse(text) : JSON.parse(text)` (em `try/catch`).
  - Acumula erros em `errors: string[]`:
    - Raiz: deve ser objeto plano; chaves permitidas apenas `target`, `examples`, `holdout`, `seed` (qualquer outra -> erro `unknown field: <k>`).
    - `target`: objeto plano apenas com `module` e `export`. `target.module`: string não vazia, relativa (não começa com `/`), sem segmento `..`, terminada em `.ts` ou `.js`. `target.export`: string casando `/^[A-Za-z_$][\w$]*$/`.
    - `seed`: se presente, deve ser `string` (default `""`).
    - `examples`: array com `length >= 2`.
    - Cada item de `examples`: objeto plano apenas com chaves `input`, `output` e opcional `name` (chave extra -> erro).
      - `input`: deve ser `Array.isArray(item.input)`.
      - `output`: chave `"output" in item && item.output !== undefined` obrigatória (`null` é válido!).
      - `name`: se ausente ou `undefined`, resolve para `` `ex-${i + 1}` `` (1-based na ordem original); se presente, string com `1 <= name.trim().length <= 80`.
      - Nomes repetidos -> erro `nome repetido: ...`.
      - Duas entradas com o mesmo `canonicalJson(item.input)` -> erro contendo `"input repetido"`.
    - `holdout`: se ausente/`undefined`, default `Math.max(1, Math.floor(n / 5))` onde `n = examples.length`. Se presente, deve ser inteiro (`Number.isInteger(h)`) com `0 <= h <= n - 1`.
- `exampleKey(task: string, seed: string, e: Example): string`:
  - `sha256hex(\`${task}\\n${seed}\\n${canonicalJson(e)}\`)`
- `partitionExamples(spec: ExamplesSpec, task: string): { visible: Example[]; holdout: Example[] }`:
  - Ordena cópia dos índices `[0..n-1]` por `exampleKey(task, spec.seed, spec.examples[i])` crescente.
  - Os primeiros `spec.holdout` índices formam o conjunto `holdout`; os demais formam `visible`.
  - Ambos `visible` e `holdout` são retornados **na ordem original** de `spec.examples`!
- `renderExamplesTest(input: { task: string; set: "visible" | "holdout"; importPath: string; exportName: string; examples: Example[] }): string`:
  - Função pura determinística:
    - 1ª linha: `GENERATED_HEADER`
    - 2ª linha: `` `// task ${input.task} · conjunto ${input.set} · ${input.examples.length} exemplos · sha256 ${sha256hex(canonicalJson(input.examples))}` ``
    - Importa `import { expect, test } from "bun:test";` e `import { ${input.exportName} } from ${JSON.stringify(input.importPath)};`
    - Para cada exemplo `ex` em `input.examples`, gera um `test(${JSON.stringify(ex.name)}, async () => { const args = ${canonicalJson(ex.input)} as unknown[]; expect(await (${input.exportName} as (...a: unknown[]) => unknown)(...args)).toEqual(${canonicalJson(ex.output)}); });`
- `visibleTestPath(task: string): string` -> `` `tests/examples/${task}.test.ts` ``
- `holdoutRunnerPath(task: string): string` -> `` `.pinga/holdout-run/${task}.test.ts` ``
- `holdoutDir(env: Record<string, string | undefined> = process.env): string` -> `(env.PINGA_HOLDOUT_DIR && env.PINGA_HOLDOUT_DIR.length > 0) ? env.PINGA_HOLDOUT_DIR : join(homedir(), ".local/state/pinga/holdout")`
- `holdoutStorePath(repoRoot: string, task: string, env: Record<string, string | undefined> = process.env): string`:
  - `const repoKey = sha256hex(realpathSync(repoRoot)).slice(0, 16);`
  - `return join(holdoutDir(env), repoKey, \`${task}.json\`);`
- `examplesPlan(planPath: string, opts: { from?: string }): number`:
  - Sem `opts.from` -> stderr, exit `2`.
  - Lê e valida `planPath` via `parsePlan`; se falhar -> stderr, exit `3`.
  - Resolve `repoRoot` (`git rev-parse --show-toplevel` a partir do dir do plano, fallback `dirname(resolve(planPath))`) e `task = basename(dirname(resolve(planPath)))`.
  - Verifica se `opts.from` existe; se não existir -> stderr, exit `1`.
  - Verifica se `realpathSync(resolve(opts.from))` está dentro de `realpathSync(repoRoot)` (ex: `fromReal === repoReal || fromReal.startsWith(repoReal + "/")`); se estiver -> stderr `"examples dentro do repo vazam o holdout"`, exit `2`, nada gravado.
  - Determina formato (`opts.from.endsWith(".yaml") || opts.from.endsWith(".yml") ? "yaml" : "json"`) e chama `parseExamples`; se `!ok` -> imprime erros no stderr e retorna `1`.
  - Calcula `partitionExamples(spec, task)` e renderiza `visibleContent = renderExamplesTest({ task, set: "visible", importPath, exportName: spec.target.export, examples: visible })`, onde `importPath` é o caminho relativo POSIX de `dirname(join(repoRoot, visibleTestPath(task)))` até `join(repoRoot, spec.target.module)` (garantindo prefixo `./` ou `../`, ex. `../../src/double.ts`).
  - Se `holdout.length > 0`, prepara `storeContent = canonicalJson({ v: 1, task, target: spec.target, examples: holdout })`.
  - **Checagem de idempotência ANTES de gravar qualquer um dos dois arquivos**:
    - Se `visFile` já existe e `readFileSync(visFile, "utf8") !== visibleContent` -> stderr `"já existe e difere"`, exit `1`.
    - Se `holdout.length > 0` e `storeFile` já existe e `readFileSync(storeFile, "utf8") !== storeContent` -> stderr `"já existe e difere"`, exit `1`.
  - Grava `visFile` e (se `holdout.length > 0`) `storeFile`.
  - `holdout_sha256 = holdout.length > 0 ? sha256hex(storeContent) : null`.
  - Imprime `canonicalJson({ task, test: visibleTestPath(task), visible: visible.length, holdout: holdout.length, holdout_sha256 })` no stdout e retorna `0`.
- `export type HoldoutRun = { exit: number | null; timedOut: boolean; duration_ms: number; artifact: { path: string; sha256: string } };`
- `runHoldout(repoRoot: string, task: string, attempt: number, timeoutMs: number): HoldoutRun | null`:
  - Verifica se `storeFile = holdoutStorePath(repoRoot, task)` existe; se não existir, retorna `null`.
  - Lê `storeFile` (`{ v: 1, task, target, examples }`); se `examples` vazio, retorna `null`.
  - Calcula `runnerRel = holdoutRunnerPath(task)` e `runnerAbs = join(repoRoot, runnerRel)`.
  - Renderiza o teste holdout com `renderExamplesTest({ task, set: "holdout", importPath, exportName: target.export, examples })`.
  - No `try { ... } finally { rmSync(runnerAbs, { force: true }); }`:
    - Grava `runnerAbs` (criando `.pinga/holdout-run` com `mkdirSync(..., { recursive: true })`).
    - Roda `Bun.spawnSync(["bun", "test", `./${runnerRel}`], { cwd: repoRoot, timeout: timeoutMs, stdout: "pipe", stderr: "pipe" })`.
    - Salva `outBuffer = Buffer.concat([res.stdout, res.stderr])` em `artifactPath = resolve(join(holdoutDir(), "runs", repoKey, task, `${attempt}.txt`))`.
    - Retorna `{ exit: timedOut ? null : res.exitCode, timedOut, duration_ms, artifact: { path: artifactPath, sha256: sha256hex(outBuffer) } }`.

### 3. `src/verify.ts`
- Quando o `done_when` terminar sem timeout e com `res.exitCode === 0`:
  - Chame `const hRun = runHoldout(repoRoot, task, attempt, timeoutMs);`
  - Se `hRun === null`: mantém o comportamento atual (`status = "pass"`, `evidence` com 1 item).
  - Se `hRun !== null`:
    - O comando do holdout para `cmd_sha256` é `` `bun test ./${holdoutRunnerPath(task)}` ``.
    - Adicione `evidence[1]` = `{ kind: "command", cmd_sha256: sha256hex(\`bun test ./\${holdoutRunnerPath(task)}\`), exit: hRun.exit, duration_ms: hRun.duration_ms, artifact_ref: hRun.artifact }`.
    - Se `hRun.timedOut`:
      - `status = "blocked"`, `reason_code = "budget"`, `cliExit = 2`, `summary = \`\${task} blocked: holdout timeout em \${Math.round(hRun.duration_ms / 1000)}s\`.slice(0, 280)`
    - Senão se `hRun.exit === 0`:
      - `status = "pass"`, `reason_code = null`, `cliExit = 0`, `summary = \`\${normalSummary()} · holdout ok\`.slice(0, 280)`
    - Senão (`hRun.exit !== 0`):
      - Calcula `sig = computeFailureSignature({ exit: hRun.exit, out_sha256: hRun.artifact.sha256, reason_code: "overfit_holdout" })` e consulta `prev = lastReceiptFor(ledger, task)`.
      - Se `shouldTrip(prev, sig)`:
        - `status = "blocked"`, `reason_code = "breaker_same_failure"`, `cliExit = BREAKER_EXIT` (4), `breaker = { tripped: true, failure_signature: sig }`, `summary = \`\${task} blocked: disjuntor armado, mesma falha 2x seguidas (holdout exit \${hRun.exit}); escalar ao dono\`.slice(0, 280)`
      - Senão:
        - `status = "fail"`, `reason_code = "overfit_holdout"`, `cliExit = OVERFIT_EXIT` (9), `breaker = { tripped: false, failure_signature: sig }`, `summary = \`\${task} fail: visíveis passam, holdout falhou (overfit ao contrato visível)\`.slice(0, 280)`
    - Atenção: a regra de `flow: "awaiting_judge"` e `next_action: "pinga judge"` (T09) só se aplica quando o `status` final do recibo é `"pass"` e `modeDecision.effective === "completo"`.

### 4. `src/cli.ts`
- Adicione o subcomando `examples`:
  `pinga examples <PLAN.md> --from <PATH>`
  - Sem plano, sem `--from`, flag desconhecida ou flag sem valor -> stderr e exit `2`.
- Atualize `USAGE` com a linha do `examples`.

## Regras de Git e Finalização
1. Rode `bun test tests/examples.test.ts` e `bun test` até que **todos** os testes passem.
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` (`src/examples.ts`, `src/verify.ts`, `src/receipt.ts`, `src/cli.ts`) foi modificado.
3. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add src/examples.ts src/verify.ts src/receipt.ts src/cli.ts
   git commit -m "feat(T10): examples sem LLM e holdout reservado (I13 / I14)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN.
