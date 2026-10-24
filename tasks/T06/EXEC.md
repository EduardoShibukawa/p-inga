Você é o EXECUTOR da T06 (opencode opencode/glm-5.3-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `4852e65` (`test(T06): RED medição estruturada de tokens (I4 / Lei 1)`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/tokens.ts", "src/verify.ts", "src/cli.ts"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- Nunca `git add .`/`-A`: sempre caminhos explícitos (`git add src/tokens.ts src/verify.ts src/cli.ts`). Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Nunca rode `bunx tsc`. Só built-ins do Bun 1.4.4.
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T06/EXEC.md` no commit.

== 2. CONTRATO DA T06 ==
Leia `tasks/T06/PLAN.md`, `tasks/T06/RED.md`, `src/verify.ts`, `src/cli.ts` e `tests/tokens.test.ts` inteiros.

Implemente:
1. `src/tokens.ts`:
```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Receipt } from "./receipt";

export type UsageTotals = {
  in: number;
  out: number;
  cache: number | null;
  cost_usd: number | null;
  lines: number;
};
export type TokenFields = Pick<Receipt, "tokens" | "cost_usd" | "cost_evidence">;

export const NOT_RUN_TOKENS: TokenFields = {
  tokens: { in: null, out: null, cache: null, source: null },
  cost_usd: null,
  cost_evidence: "not run",
};

export function parseUsageJsonl(
  text: string,
): { ok: true; totals: UsageTotals } | { ok: false; error: string };

export function resolveUsageFile(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null;

export function tokenFieldsFor(path: string | null): TokenFields;
```
Detalhes de `parseUsageJsonl(text)`:
- Faça split por `/\r?\n/`. Numere as linhas a partir de 1. Ignore linhas em branco (`line.trim() === ""`).
- Se `JSON.parse(line)` falhar na linha `i`, retorne `{ ok: false, error: `JSON inválido na linha ${i}` }`.
- Reconheça os 3 formatos (pelas chaves):
  a) **Claude Code**: `obj.message?.usage` onde `input_tokens !== undefined || output_tokens !== undefined`:
     - Se `typeof obj.message.id === "string"` e já vimos esse `id`, ignore a linha (dedup). Caso contrário registre o `id`.
     - Valide `input_tokens` e `output_tokens` como inteiros `>= 0` (`Number.isInteger(n) && n >= 0`); se não forem, `{ ok: false, error: ... }`.
     - Cache: se `cache_read_input_tokens !== undefined` ou `cache_creation_input_tokens !== undefined`, valide os presentes como inteiros `>= 0`, marque `hasCache = true` e some `(cache_read_input_tokens ?? 0) + (cache_creation_input_tokens ?? 0)`.
     - Custo: se `obj.costUSD !== undefined` (e `!== null`), valide `typeof obj.costUSD === "number" && Number.isFinite(obj.costUSD) && obj.costUSD >= 0`, marque `hasCost = true` e some.
  b) **pi**: `u = (obj.message?.usage?.input !== undefined || obj.message?.usage?.output !== undefined) ? obj.message.usage : (obj.usage?.input !== undefined || obj.usage?.output !== undefined) ? obj.usage : null`:
     - Valide `u.input` e `u.output` como inteiros `>= 0`.
     - Cache: se `u.cacheRead !== undefined || u.cacheWrite !== undefined`, valide os presentes como inteiros `>= 0`, marque `hasCache = true` e some `(u.cacheRead ?? 0) + (u.cacheWrite ?? 0)`.
     - Custo: se `u.cost?.total !== undefined` (e `!== null`), valide número finito `>= 0`, marque `hasCost = true` e some.
  c) **opencode/agy**: `t = obj.tokens` (objeto com `input !== undefined || output !== undefined`):
     - Valide `t.input` e `t.output` como inteiros `>= 0`.
     - Cache: se `t.cache !== undefined && t.cache !== null`:
       - se `typeof t.cache === "number"`: valide inteiro `>= 0`, `hasCache = true`, some `t.cache`.
       - se objeto `{ read?, write? }`: valide presentes como inteiros `>= 0`, `hasCache = true`, some `(t.cache.read ?? 0) + (t.cache.write ?? 0)`.
     - Custo: `c = obj.cost_usd ?? obj.cost`; se `c !== undefined && c !== null`, valide número finito `>= 0`, `hasCost = true`, some `c`.
- Linhas que não casam com nenhum dos 3 formatos são ignoradas.
- Ao final, se `lines === 0`, retorne `{ ok: false, error: "nenhuma linha de uso encontrada" }`.
- Retorne `{ ok: true, totals: { in: totalIn, out: totalOut, cache: hasCache ? totalCache : null, cost_usd: hasCost ? Number(totalCost.toFixed(6)) : null, lines } }`.

Detalhes de `tokenFieldsFor(path)`:
- Se `path === null`, retorne `{ tokens: { ...NOT_RUN_TOKENS.tokens }, cost_usd: null, cost_evidence: "not run" }`.
- `const abs = resolve(path);`
- Tente `const bytes = readFileSync(abs);`. Se falhar, retorne `{ tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: `invalid:${abs}: ${(err as Error).message}`.slice(0, 280) }`.
- Chame `parseUsageJsonl(bytes.toString("utf8"))`. Se `!parsed.ok`, retorne `{ tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: `invalid:${abs}: ${parsed.error}`.slice(0, 280) }`.
- Se `parsed.ok`, calcule `sha = createHash("sha256").update(bytes).digest("hex")` e retorne:
  `{ tokens: { in: parsed.totals.in, out: parsed.totals.out, cache: parsed.totals.cache, source: "host-structured" }, cost_usd: parsed.totals.cost_usd, cost_evidence: `host-structured:${abs}#${sha}` }`.

2. `src/verify.ts`:
- Estenda `VerifyOptions`: `export type VerifyOptions = { base?: string; usageFile?: string };`
- Crie helper que resolve `const usagePath = resolveUsageFile(opts?.usageFile); const tf = tokenFieldsFor(usagePath); if (tf.cost_evidence.startsWith("invalid:")) console.error(\`usage warning: \${tf.cost_evidence}\`); return tf;`
- Chame esse helper no momento de montar o recibo (depois do `done_when`, ou nos retornos de `plan_invalid` e guardas `tests_frozen_changed`/`scope_drift`) e preencha `tokens: tf.tokens, cost_usd: tf.cost_usd, cost_evidence: tf.cost_evidence` em **TODOS** os recibos gerados pelo `verifyPlan`.

3. `src/cli.ts`:
- Em `verify`, adicione suporte a `--usage-file <PATH>` (se faltar valor ou começar com `--`, exit 2) e passe `usageFile` em `opts` de `verifyPlan`.

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato: `bun test tests/tokens.test.ts`
2. Rode a suíte inteira: `bun test`
3. Confirme que `tests_frozen` não mudou:
   `git diff 4852e65..HEAD -- tests/tokens.test.ts tests/breaker.test.ts tests/guards.test.ts tests/verify.test.ts tests/ledger.test.ts tests/receipt.test.ts tests/repo.test.ts`
4. Commit GREEN:
   ```bash
   git add src/tokens.ts src/verify.ts src/cli.ts
   git commit -m "feat(T06): medição estruturada de tokens (I4 / Lei 1)" -m "Co-Authored-By: glm-5.3-flash-free <noreply@zhipuai.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Cole a saída de `bun test tests/tokens.test.ts`, `bun test`, o sha do commit GREEN e `git diff --stat 4852e65..HEAD`. Depois PARE.
