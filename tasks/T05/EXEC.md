Você é o EXECUTOR da T05 (opencode opencode/deepseek-v4.1-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `de8f0b7` (`test(T05): RED disjuntor automático (I3 / Lei 3)`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/breaker.ts", "src/verify.ts"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- Nunca `git add .`/`-A`: sempre caminhos explícitos (`git add src/breaker.ts src/verify.ts`). Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Nunca rode `bunx tsc`. Só built-ins do Bun 1.4.4.
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T05/EXEC.md` no commit.

== 2. CONTRATO DA T05 ==
Leia `tasks/T05/PLAN.md`, `tasks/T05/RED.md`, `src/verify.ts`, `src/ledger.ts`, `src/canonical.ts` e `tests/breaker.test.ts` inteiros.

Implemente:
1. `src/breaker.ts`:
```ts
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical";
import type { Ledger } from "./ledger";
import type { ReasonCode, Receipt } from "./receipt";

export const BREAKER_EXIT = 4;
export const BREAKER_NEXT_ACTION = "escalar ao dono";

export type FailureInput = {
  exit: number | null;
  out_sha256: string | null;
  reason_code: ReasonCode | null;
};

export function computeFailureSignature(f: FailureInput): string {
  const payload = canonicalJson({
    exit: f.exit,
    out_sha256: f.out_sha256,
    reason_code: f.reason_code,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function lastReceiptFor(ledger: Ledger, task: string): Receipt | null {
  const rows = ledger.all().filter((r) => r.task === task);
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1]!;
  return JSON.parse(last.body) as Receipt;
}

export function shouldTrip(prev: Receipt | null, signature: string): boolean {
  if (prev === null) return false;
  if (prev.status !== "fail" && prev.status !== "blocked") return false;
  return prev.breaker?.failure_signature === signature;
}
```

2. `src/verify.ts`:
   - Apenas quando o `done_when` rodou, terminou **sem timeout** (`!timedOut`) e saiu com **`res.exitCode !== 0`**:
     - Calcule `const sig = computeFailureSignature({ exit: res.exitCode, out_sha256: outSha256, reason_code: "command_failed" });`
     - Obtenha `const prev = lastReceiptFor(ledger, task);` (ANTES de chamar `ledger.append(receipt)`).
     - Se `shouldTrip(prev, sig)` for `true`:
       - `status = "blocked"`
       - `reason_code = "breaker_same_failure"`
       - `evidenceExit = res.exitCode`
       - `cliExit = BREAKER_EXIT` (4)
       - inclua no recibo:
         - `breaker: { tripped: true, failure_signature: sig }`
         - `next_action: BREAKER_NEXT_ACTION` (`"escalar ao dono"`)
         - `summary: `${task} blocked: disjuntor armado, mesma falha 2x seguidas (exit ${evidenceExit}); escalar ao dono`.slice(0, 280)`
     - Caso contrário (`shouldTrip(prev, sig) === false`):
       - `status = "fail"`
       - `reason_code = "command_failed"`
       - `evidenceExit = res.exitCode`
       - `cliExit = 1`
       - inclua no recibo:
         - `breaker: { tripped: false, failure_signature: sig }`
         - `summary` normal da T03 (`` `${task} ${status}: done_when exit ${evidenceExit} em ${segundos}s`.slice(0, 280) ``)
   - Quando `pass`, timeout (`budget`), `plan_invalid` ou bloqueios de guarda (`tests_frozen_changed`, `scope_drift`), **NÃO** adicione o campo `breaker` nem `next_action` no recibo.

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato: `bun test tests/breaker.test.ts`
2. Rode a suíte inteira: `bun test`
3. Confirme que `tests_frozen` não mudou:
   `git diff de8f0b7..HEAD -- tests/breaker.test.ts tests/guards.test.ts tests/verify.test.ts tests/ledger.test.ts tests/receipt.test.ts tests/repo.test.ts`
4. Commit GREEN:
   ```bash
   git add src/breaker.ts src/verify.ts
   git commit -m "feat(T05): disjuntor automático (I3 / Lei 3) no pinga verify" -m "Co-Authored-By: deepseek-v4.1-flash-free <noreply@deepseek.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Cole a saída de `bun test tests/breaker.test.ts`, `bun test`, o sha do commit GREEN e `git diff --stat de8f0b7..HEAD`. Depois PARE.
