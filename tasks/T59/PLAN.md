---
mode: padrao
goal: "verify ganha --allow-verifier-drift (opt-in) que libera scope_drift apenas para arquivos do próprio verifier (src/verify.ts, src/receipt.ts, src/guards.ts), mantém scope_drift para qualquer outro arquivo fora do touch e registra cada liberação no artefato"
touch:
  - src/verify.ts
  - src/guards.ts
  - src/cli.ts
done_when: "bun test tests/verify_verifier_drift.test.ts"
tests_frozen: ["tests/verify_verifier_drift.test.ts"]
---
# T59: task fechada não é re-verificável depois de corrigir o verifier

Re-verificar T54/T55/T56 com o verifier de `61a3dbe` devolveu `scope_drift` nas
três: o `touch` das tasks antigas não lista `src/verify.ts`/`src/receipt.ts`, e o
recibo `blocked` ainda revoga o `done` no ledger da fila. Não há flag de escape —
só `--allow-no-delta` (worktrees `wtv2`, 2026-10-27). O reparo de hoje é manual
(verifier da própria base), o que não serve quando o fix é o que se quer validar.

Correção: `--allow-verifier-drift` (opt-in) em `src/cli.ts` → `allowVerifierDrift`;
em `src/guards.ts` a lista fixa de arquivos do verifier entra em `allowed` só com
a flag. Estreito: só paths fora do `touch` nessa lista, e o artefato
`runs/<T>/<n>/out.txt` recebe `allowed_drift: <path>` por liberação.

Teste congela três lados: sem flag continua `scope_drift`; com flag libera só o
verifier (registrado no artefato); arquivo comum fora do `touch` segue `scope_drift`.
