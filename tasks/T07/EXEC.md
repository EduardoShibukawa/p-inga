Você é o EXECUTOR da T07 (opencode opencode/glm-5.3-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `c9cf490` (`test(T07): RED geração e validação de EVAL.md via pinga eval`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/eval.ts", "src/cli.ts"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- Nunca `git add .`/`-A`: sempre caminhos explícitos (`git add src/eval.ts src/cli.ts`). Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Nunca rode `bunx tsc`. Só built-ins do Bun 1.4.4.
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T07/EXEC.md` no commit.

== 2. CONTRATO DA T07 ==
Leia `tasks/T07/PLAN.md`, `tasks/T07/RED.md`, `src/cli.ts`, `src/guards.ts`, `src/ledger.ts`, `src/plan.ts` e `tests/eval.test.ts` inteiros.

Implemente:
1. `src/eval.ts`:
```ts
import type { Receipt, Status } from "./receipt";

export const PLANNER_DEFAULT = { model: "gemini-4-argon", family: "gemini" } as const;

export type Scope = {
  tests_frozen: "intacto" | "ALTERADO" | "sem base";
  out_of_touch: string[] | null;
};
export type OwnerFields = { bom: string; ruim: string; mudar: string };
export type EvalDoc = {
  task: string;
  executor: string;
  planner: string;
  status: Status;
  attempts: number;
  minutes: number;
  tokens: string;
  scope: Scope;
  parecer: string;
  dono: OwnerFields;
};

export function renderEval(doc: EvalDoc): string;
export function parseEval(text: string):
  | { ok: true; doc: EvalDoc }
  | { ok: false; errors: string[] };
export function validateEval(text: string, task?: string):
  | { ok: true }
  | { ok: false; errors: string[] };
export function extractOwnerFields(text: string): OwnerFields & { parecer: string | null };
export function summarizeTokens(receipts: Receipt[]): string;
export function evalPlan(planPath: string, opts?: { ledgerPath?: string; check?: boolean }): number;
```

Regras detalhadas de `src/eval.ts`:
- `renderEval(doc)`:
  - Produz exatamente 9 linhas terminadas por `\n`:
    1. `## EVAL ${doc.task}`
    2. `executor: ${doc.executor} · planejador: ${doc.planner}`
    3. `auto:   status ${doc.status} · tentativas ${doc.attempts} · tempo ${doc.minutes} min · tokens ${doc.tokens}`
    4. `escopo: tests_frozen ${doc.scope.tests_frozen} · fora do touch: ${outOfTouchStr}`
       onde `outOfTouchStr` é `"sem base"` se `doc.scope.out_of_touch === null`, `"nenhum"` se `doc.scope.out_of_touch.length === 0`, ou `[...doc.scope.out_of_touch].sort().join(", ")`.
    5. `parecer: ${doc.parecer}`
    6. `dono:`
    7. `doc.dono.bom ? \`  bom:   \${doc.dono.bom}\` : "  bom:"`
    8. `doc.dono.ruim ? \`  ruim:  \${doc.dono.ruim}\` : "  ruim:"`
    9. `doc.dono.mudar ? \`  mudar: \${doc.dono.mudar}\` : "  mudar:"`
- `parseEval(text)` e `validateEval(text, task?)`:
  - Remova uma única quebra de linha final (`text.replace(/\r?\n$/, "").split(/\r?\n/)`).
  - Se `lines.length !== 9`, adicione erro; mas ainda tente validar cada linha para acumular erros (`errors.length >= 3` quando houver 3 problemas!).
  - Valide cada linha contra as regexes da `RED.md`:
    - L0: `/^## EVAL (\S+)$/` (e se `task` foi passado em `validateEval`, `match[1] === task`, senão erro).
    - L1: `/^executor: (.+ \(.+\)) · planejador: (.+ \(.+\))$/`
    - L2: `/^auto:\s+status (pass|fail|blocked|not run) · tentativas (\d+) · tempo (\d+) min · tokens (.+)$/`
      - Verifique `Number(tentativas) >= 1`, `Number(tempo) >= 0`, e `tokens` casa `/^not run$/` ou `/^in=\d+ out=\d+ cache=(\d+|null) usd=(\d+(\.\d+)?|null)$/`.
    - L3: `/^escopo: tests_frozen (intacto|ALTERADO|sem base) · fora do touch: (.+)$/`
      - Se `fora do touch` for `"sem base"` → `out_of_touch: null`; se `"nenhum"` → `[]`; senão `str.split(", ").map(s => s.trim()).filter(Boolean)`.
    - L4: `/^parecer: (.+)$/` (não vazio após trim).
    - L5: `/^dono:$/`
    - L6: `/^  bom:\s*(.*)$/`
    - L7: `/^  ruim:\s*(.*)$/`
    - L8: `/^  mudar:\s*(.*)$/`
- `extractOwnerFields(text)`:
  - Varre linha a linha:
    - `/^parecer:\s*(.*)$/` → se `match[1].trim().length > 0`, `parecer = match[1].trim()`.
    - `/^\s*bom:\s*(.*)$/` → `bom = match[1].trim()`
    - `/^\s*ruim:\s*(.*)$/` → `ruim = match[1].trim()`
    - `/^\s*mudar:\s*(.*)$/` → `mudar = match[1].trim()`
  - Retorna `{ bom, ruim, mudar, parecer }` (com defaults `""` e `null`).
- `summarizeTokens(receipts)`:
  - Filtra `measured = receipts.filter(r => r.tokens.source === "host-structured")`.
  - Se `measured.length === 0`, retorna `"not run"`.
  - Soma `in` (`r.tokens.in ?? 0`) e `out` (`r.tokens.out ?? 0`).
  - Se algum recibo em `measured` tem `r.tokens.cache !== null`, soma os não-nulos; senão `cacheStr = "null"`.
  - Se algum recibo em `measured` tem `r.cost_usd !== null`, soma os não-nulos e formata `String(Number(sumCost.toFixed(6)))`; senão `usdStr = "null"`.
  - Retorna `` `in=${sumIn} out=${sumOut} cache=${cacheStr} usd=${usdStr}` ``.
- `evalPlan(planPath, opts)`:
  - `resolvedPlan = resolve(planPath)`, `task = basename(dirname(resolvedPlan))`, `evalPath = join(dirname(resolvedPlan), "EVAL.md")`.
  - Se `opts?.check === true`:
    - Nunca escreve no arquivo!
    - Se `!existsSync(evalPath)`, `console.error("EVAL.md ausente")`, retorna `1`.
    - Roda `validateEval(readFileSync(evalPath, "utf8"), task)`. Se `!v.ok`, `console.error(v.errors.join("\n"))`, retorna `1`.
    - Se `v.ok`, `console.log(\`ok \${evalPath}\`)`, retorna `0`.
  - Modo geração (`!opts?.check`):
    - Abre o ledger (`opts?.ledgerPath ?? defaultLedgerPath()`), lê todos os recibos de `task` (`JSON.parse(row.body) as Receipt`), e fecha o ledger.
    - Se `receipts.length === 0`, `console.error(\`sem recibos para \${task}\`)`, retorna `1` (sem escrever `EVAL.md`).
    - Último recibo = `receipts[receipts.length - 1]!`.
    - `status = last.status`, `attempts = receipts.length`.
    - Soma `duration_ms` de todos os `evidence` de todos os `receipts` da task: `minutes = Math.ceil(totalDurationMs / 60000)`.
    - `tokens = summarizeTokens(receipts)`.
    - `execModel = last.author.model ?? "desconhecido"`, `execFamily = last.author.family ?? "desconhecida"`.
    - `executor = \`\${execModel} (\${execFamily})\``.
    - `planModel = (process.env.PINGA_PLANNER_MODEL && process.env.PINGA_PLANNER_MODEL !== "") ? process.env.PINGA_PLANNER_MODEL : PLANNER_DEFAULT.model`.
    - `planFamily = (process.env.PINGA_PLANNER_FAMILY && process.env.PINGA_PLANNER_FAMILY !== "") ? process.env.PINGA_PLANNER_FAMILY : PLANNER_DEFAULT.family`.
    - `planner = \`\${planModel} (\${planFamily})\``.
    - **Escopo ao vivo:**
      - Descubra `repoRoot` com `git rev-parse --show-toplevel` (cwd = `dirname(resolvedPlan)`).
      - Parseie o plano com `parsePlan(readFileSync(resolvedPlan, "utf8"))`.
      - `base = findRedBase(repoRoot, task)`.
      - Se `base === null`, `scope = { tests_frozen: "sem base", out_of_touch: null }`.
      - Senão:
        - `changed = changedFiles(repoRoot, base)`.
        - `frozenSet = new Set(parsedPlan.ok && parsedPlan.plan.tests_frozen ? parsedPlan.plan.tests_frozen : [])`.
        - `tests_frozen = changed.some(f => frozenSet.has(f)) ? "ALTERADO" : "intacto"`.
        - `touchSet = new Set([...(parsedPlan.ok && parsedPlan.plan.touch ? parsedPlan.plan.touch : []), ...alwaysAllowed(task)])`.
        - `out_of_touch = changed.filter(f => !touchSet.has(f)).sort()`.
    - **Preservação (`EVAL.md` existente):**
      - Se `existsSync(evalPath)`, `existing = extractOwnerFields(readFileSync(evalPath, "utf8"))`, senão `{ bom: "", ruim: "", mudar: "", parecer: null }`.
      - Se `last.author.family !== null && last.author.family === planFamily`, `parecer = "n/a: mesma família"`.
      - Senão, se `existing.parecer && existing.parecer !== "n/a: mesma família"`, `parecer = existing.parecer`; senão `parecer = "pendente"`.
    - Escreva `writeFileSync(evalPath, renderEval(doc), "utf8")`, imprima `console.log(evalPath)` e retorne `0`.

2. `src/cli.ts`:
- Adicione na `USAGE` e no `runCli`:
  `pinga eval <PLAN.md> [--ledger PATH] [--check]`
- Se faltar `<PLAN.md>`, se `--ledger` não tiver valor, ou se houver qualquer flag desconhecida → `console.error(USAGE); return 2;`.

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato: `bun test tests/eval.test.ts`
2. Rode a suíte inteira: `bun test`
3. Confirme que `tests_frozen` não mudou:
   `git diff c9cf490..HEAD -- tests/eval.test.ts tests/tokens.test.ts tests/breaker.test.ts tests/guards.test.ts tests/verify.test.ts tests/ledger.test.ts tests/receipt.test.ts tests/repo.test.ts`
4. Commit GREEN:
   ```bash
   git add src/eval.ts src/cli.ts
   git commit -m "feat(T07): geração e validação de EVAL.md via pinga eval" -m "Co-Authored-By: glm-5.3-flash-free <noreply@zhipuai.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Cole a saída de `bun test tests/eval.test.ts`, `bun test`, o sha do commit GREEN e `git diff --stat c9cf490..HEAD`. Depois PARE.
