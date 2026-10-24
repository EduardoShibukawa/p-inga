# RED T10 — tests/examples.test.ts (+ `tests/receipt.test.ts`)

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.YAML`, `Bun.spawnSync`, `node:crypto`, `node:fs`, `node:path`, `node:os`). Zero dependências npm (D4). Todo caso que grava holdout usa `PINGA_HOLDOUT_DIR=<mkdtemp>`, nunca o `~/.local/state` real.

O commit RED também altera `tests/receipt.test.ts`: a expectativa de `REASON_CODES` ganha `"overfit_holdout"` no fim (SPEC 0002 §4.1).

## API esperada

```ts
// src/examples.ts
export const OVERFIT_EXIT = 9;
export const GENERATED_HEADER = "// gerado por pinga examples (T10): não editar";

export type Example = { name: string; input: unknown[]; output: unknown };
export type ExamplesSpec = {
  target: { module: string; export: string };   // module relativo à raiz do repo
  holdout: number;                               // já resolvido (default aplicado)
  seed: string;                                  // default ""
  examples: Example[];                           // names já resolvidos, na ordem original
};
export function parseExamples(text: string, format: "json" | "yaml"):
  | { ok: true; spec: ExamplesSpec }
  | { ok: false; errors: string[] };
export function exampleKey(task: string, seed: string, e: Example): string;
//   sha256hex(`${task}\n${seed}\n${canonicalJson(e)}`)
export function partitionExamples(spec: ExamplesSpec, task: string): { visible: Example[]; holdout: Example[] };
export function renderExamplesTest(input: {
  task: string; set: "visible" | "holdout"; importPath: string; exportName: string; examples: Example[];
}): string;
export function visibleTestPath(task: string): string;            // `tests/examples/${task}.test.ts`
export function holdoutRunnerPath(task: string): string;          // `.pinga/holdout-run/${task}.test.ts`
export function holdoutDir(env?: Record<string, string | undefined>): string;
//   env.PINGA_HOLDOUT_DIR não vazio ?? join(homedir(), ".local/state/pinga/holdout")
export function holdoutStorePath(repoRoot: string, task: string, env?: Record<string, string | undefined>): string;
//   join(holdoutDir(env), sha256hex(realpathSync(repoRoot)).slice(0, 16), `${task}.json`)
export function examplesPlan(planPath: string, opts: { from?: string }): number;   // CLI pinga examples
export type HoldoutRun = { exit: number | null; timedOut: boolean; duration_ms: number; artifact: { path: string; sha256: string } };
export function runHoldout(repoRoot: string, task: string, attempt: number, timeoutMs: number): HoldoutRun | null;
//   null se não existe holdout guardado para (repoRoot, task)
```

## Comportamento esperado

1. **Arquivo de exemplos** (`--from`): `.yaml`/`.yml` → `Bun.YAML.parse`; senão `JSON.parse`. Formato:
   ```json
   { "target": { "module": "src/money.ts", "export": "invoice" },
     "holdout": 1, "seed": "s1",
     "examples": [ { "name": "meio centavo sobe", "input": [25, 10], "output": { "discount": 3, "total": 22 } } ] }
   ```
2. **`parseExamples`** acumula erros:
   - raiz só com `target`, `examples` e opcionais `holdout`, `seed` (string); chave extra → erro;
   - `target.module`: string relativa, sem `..`, sem `/` inicial, terminada em `.ts` ou `.js`; `target.export` casa `^[A-Za-z_$][\w$]*$`;
   - `examples`: array com **≥ 2** itens; cada item só com `input` (array), `output` (obrigatório, pode ser `null`) e `name` opcional (string 1..80);
   - `name` ausente → `ex-<i>` (índice 1-based na ordem original); nomes repetidos → erro;
   - duas entradas com o mesmo `canonicalJson(input)` → erro `input repetido` (senão um par visível/holdout vaza o holdout);
   - `holdout` inteiro com `0 ≤ holdout ≤ n − 1`; ausente → `max(1, floor(n / 5))`.
3. **`partitionExamples`:** ordena por `exampleKey` crescente; os `holdout` primeiros vão para o holdout, o resto é visível. Os dois conjuntos voltam na **ordem original**. Ninguém escolhe à mão quais ficam ocultos.
4. **`renderExamplesTest`:**
   - função pura: mesma entrada → mesmos bytes;
   - 1ª linha = `GENERATED_HEADER`; 2ª linha = `// task <task> · conjunto <set> · <n> exemplos · sha256 <sha256hex(canonicalJson(examples))>`;
   - importa `bun:test` e `{ <export> }` de `importPath`; um `test(name)` por exemplo, que faz `expect(await <export>(...input)).toEqual(output)`;
   - os exemplos vão inline (JSON), sem ler arquivo em runtime.
5. **`importPath`** = caminho relativo do arquivo de teste até `target.module`, com prefixo `./` ou `../`. Para `tests/examples/` e `.pinga/holdout-run/` (os dois têm profundidade 2), `src/money.ts` → `../../src/money.ts`.
6. **`pinga examples <PLAN.md> --from <arquivo>`:**
   - plano inválido → exit 3; sem `--from` ou flag desconhecida → exit 2; arquivo ilegível ou `parseExamples` com erro → erros no stderr, exit 1;
   - `--from` com caminho real **dentro** da raiz do repo → stderr `examples dentro do repo vazam o holdout`, exit 2, nada gravado;
   - grava `tests/examples/<task>.test.ts` (conjunto `visible`), criando a pasta;
   - com `holdout > 0`, grava `holdoutStorePath` = `canonicalJson({ v: 1, task, target, examples: <holdout> })`; com `holdout = 0`, não grava nada no store;
   - idempotente: se um dos arquivos já existe com **os mesmos bytes**, ok; com bytes **diferentes**, stderr `já existe e difere`, exit 1, os dois arquivos ficam como estavam;
   - stdout: `canonicalJson({ task, test: "tests/examples/<task>.test.ts", visible, holdout, holdout_sha256 })` (`holdout_sha256` = sha256 do arquivo do store, ou `null`), exit 0;
   - não abre ledger, não roda nada.
7. **`runHoldout`:**
   - sem store → `null`;
   - senão: grava `.pinga/holdout-run/<task>.test.ts` (conjunto `holdout`), roda `bun test ./.pinga/holdout-run/<task>.test.ts` com `cwd = repoRoot` e o timeout dado;
   - saída (stdout+stderr) gravada **fora da worktree**, em `join(holdoutDir(), "runs", <chave do repo>, task, `${attempt}.txt`)`; `artifact.path` é esse caminho absoluto;
   - o runner é apagado **sempre** (`finally`), mesmo com timeout ou exceção.
8. **Integração no `verify`:**
   - o holdout só roda se o `done_when` terminou com exit 0 e sem timeout. Com falha visível, o holdout **não roda** (nem o runner, nem o artefato);
   - `runHoldout` → `null`: recibo igual ao de antes (`evidence` com 1 item);
   - holdout exit 0 → `pass`, `evidence[1]` = `{ kind: "command", cmd_sha256: sha256(<comando do holdout>), exit: 0, duration_ms, artifact_ref: artifact }`, e o `summary` termina com `· holdout ok`;
   - holdout com timeout → `blocked`/`budget`, exit 2;
   - holdout com exit ≠ 0 → `fail`/`overfit_holdout`, exit **9**:
     - `summary`: `` `${task} fail: visíveis passam, holdout falhou (overfit ao contrato visível)` ``;
     - `breaker` da T05 com `computeFailureSignature({ exit, out_sha256: artifact.sha256, reason_code: "overfit_holdout" })`; mesma assinatura do recibo `verify` anterior → disjuntor (exit 4), como na T05;
   - **I14:** nenhum valor do holdout aparece no recibo, no stdout, em `runs/<task>/` nem em qualquer arquivo da worktree depois do verify.
9. **CLI:** `pinga examples <PLAN.md> --from PATH`. A `USAGE` ganha a linha do `examples`.

## Casos

Fixture de exemplos (`F5`): alvo `src/double.ts`, export `double`, sem `holdout` e sem `seed`, 5 exemplos `input: [n]`, `output: 2n` para `n ∈ {1, 2, 3, 999001, 999002}`, sem nome. Valores `9990xx` servem para procurar vazamento por substring.

Unitários:

1. `parseExamples(F5 em JSON)` → ok, nomes `ex-1`..`ex-5`, `holdout: 1`, `seed: ""`. O mesmo conteúdo em YAML → spec igual (`toEqual`).
2. Default de `holdout`: `n = 2 → 1`, `n = 5 → 1`, `n = 10 → 2`, `n = 12 → 2`. `holdout: 0` explícito → 0.
3. Inválidos (cada um com `ok: false`):
   - 1 exemplo; `input: 5`; item sem `output`; item com chave `expected`; chave `extra` na raiz;
   - dois `input: [1]` (`input repetido`); dois `name: "a"`;
   - `holdout: 5` com n = 5; `holdout: -1`; `holdout: 1.5`;
   - `module: "../x.ts"`, `"/abs/x.ts"`, `"src/x.py"`; `export: "1x"`.

   Um texto com 3 desses problemas devolve `errors.length >= 3`.
4. `exampleKey`: 64 hex; igual a `sha256hex(task + "\n" + seed + "\n" + canonicalJson(e))`; muda com `task`, `seed` ou exemplo.
5. `partitionExamples(F5, "TX")`:
   - determinístico: duas chamadas → resultados iguais;
   - `visible.length === 4`, `holdout.length === 1`, disjuntos, a união é o conjunto original;
   - o exemplo do holdout é o de menor `exampleKey`;
   - os dois conjuntos na ordem original;
   - para seeds `"a"` a `"z"`, aparecem pelo menos 2 partições diferentes (a seed muda o sorteio).
6. `renderExamplesTest`:
   - mesmos bytes em duas chamadas; 1ª linha `GENERATED_HEADER`;
   - a 2ª linha contém `conjunto visible · 4 exemplos`;
   - o teste visível não contém o `canonicalJson(input)` nem o `output` do exemplo do holdout.
7. `holdoutDir`: `{ PINGA_HOLDOUT_DIR: "/x" }` → `/x`; `{}` e `{ PINGA_HOLDOUT_DIR: "" }` → `<home>/.local/state/pinga/holdout`. `holdoutStorePath` de dois repos diferentes com a mesma task → caminhos diferentes.
8. `validateReceipt` aceita `fail`/`overfit_holdout`.

CLI e execução. Repo git temporário em `feat/x` com um commit `chore: init` contendo `.gitignore` (`runs/`, `.pinga/`, `*.db`), `tasks/TX/PLAN.md` (`done_when: "bun test tests/examples/TX.test.ts"`, `touch: ["src/double.ts"]`) e `src/double.ts` (sem commit RED, então as guardas da T04 são puladas); o conteúdo de `src/double.ts` muda conforme o caso, arquivo de exemplos num `mkdtemp` **fora** do repo e ledger temporário fora do repo. `PINGA_HOLDOUT_DIR=<mkdtemp>` no env filho. O CLI é chamado como `bun <ROOT>/bin/pinga.ts ...`.

9. `pinga examples <plan> --from <F5>` →
   - exit 0; stdout com `visible: 4`, `holdout: 1`, `test: "tests/examples/TX.test.ts"` e `holdout_sha256` de 64 hex;
   - o arquivo do store existe dentro de `PINGA_HOLDOUT_DIR`, e seu sha256 é o `holdout_sha256`;
   - `git status --porcelain` só mostra `tests/examples/`;
   - nenhum arquivo do repo contém o `output` do exemplo do holdout.
10. Idempotência: 2ª execução igual → exit 0, os dois arquivos com os mesmos bytes. Com F5 trocando um `output` → exit 1, stderr contém `já existe e difere`, os dois arquivos intactos.
11. `--from` apontando para um arquivo dentro do repo → exit 2, stderr contém `vazam o holdout`, nenhum arquivo gerado. Sem `--from` → exit 2.
12. Teste gerado roda: com `double = (n) => 2 * n`, `bun test tests/examples/TX.test.ts` no repo → exit 0 e 4 testes passando. Com `double = (n) => n` → exit ≠ 0.
13. `verify`, implementação correta →
    - exit 0, `pass`, `evidence.length === 2`, `evidence[1].exit === 0`;
    - `evidence[1].artifact_ref.path` é absoluto e começa com `PINGA_HOLDOUT_DIR`;
    - `summary` termina com `holdout ok`;
    - `.pinga/holdout-run/TX.test.ts` não existe depois.
14. `verify` com **overfit**: `double` é uma tabela montada a partir de `partitionExamples(F5, "TX").visible` (`({ [input]: output })[n] ?? 0`), que só conhece os 4 visíveis →
    - exit 9, `fail`/`overfit_holdout`;
    - `evidence[0].exit === 0`, `evidence[1].exit !== 0`;
    - `breaker.tripped === false`;
    - o stdout, `runs/TX/<attempt>/out.txt` e todos os arquivos da worktree não contêm o `output` do holdout;
    - o runner não existe depois.
15. Mesmo overfit de novo → exit 4, `blocked`/`breaker_same_failure`.
16. Visível falhando (`double = (n) => n`) → exit 1, `command_failed`, `evidence.length === 1`, e nenhum arquivo novo em `<PINGA_HOLDOUT_DIR>/runs`.
17. Sem store (task sem `pinga examples`, ou F5 com `holdout: 0`) → `evidence.length === 1`, exit como na T03.
18. Integração: todo recibo impresso nos casos 13–17 passa no `validateReceipt`, e `pinga ledger verify --ledger <tmp>` dá `ok <n>`.
