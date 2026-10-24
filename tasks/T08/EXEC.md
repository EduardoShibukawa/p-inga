Você é o EXECUTOR da T08 (opencode opencode/glm-5.3-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `76a851d` (`test(T08): RED juiz de família distinta e atestado de modelo (I10 / I11)`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/family.ts", "src/judge.ts", "src/receipt.ts", "src/breaker.ts", "src/eval.ts", "src/cli.ts", "bin/pinga.ts"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/judge.test.ts", "tests/receipt.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/repo.test.ts"]`
- Nunca `git add .`/`-A`: sempre caminhos explícitos. Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Nunca rode `bunx tsc`. Só built-ins do Bun 1.4.4 (`fetch`, `AbortSignal.timeout`, `node:crypto`, `node:fs`, `node:path`).
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T08/EXEC.md` no commit.

== 2. CONTRATO DA T08 ==
Leia `tasks/T08/PLAN.md`, `tasks/T08/RED.md`, `specs/0002-p-inga-v0.1-rodada-3.md`, `src/receipt.ts`, `src/breaker.ts`, `src/eval.ts`, `src/cli.ts`, `bin/pinga.ts` e `tests/judge.test.ts` inteiros.

Implemente:
1. `src/receipt.ts`:
   - Adicione `"judge_rejected"` e `"model_unattested"` no fim de `REASON_CODES` (nesta ordem!).
   - Adicione tipo `Attestation = { claimed: string | null; served: string; via: "/v1/models" | "transcript" }` e campo opcional `model_attested?: Attestation` em `Receipt`.
   - Em `validateReceipt`:
     - Adicione `"model_attested"` na lista de chaves permitidas da raiz.
     - Se `model_attested !== undefined`, valide que é objeto plano com exatamente as chaves `claimed`, `served`, `via` (chaves extras geram erro contendo `model_attested.<chave>`, ex.: `"unknown field: model_attested.extra"`), `claimed === null || (typeof claimed === "string" && claimed.length > 0)`, `typeof served === "string" && served.length > 0`, `via === "/v1/models" || via === "transcript"`.
   - Exporte `export function receiptKind(r: Pick<Receipt, "flow">): "verify" | "judge" { return r.flow === "judge" ? "judge" : "verify"; }`.

2. `src/breaker.ts`:
   - Em `lastReceiptFor(ledger, task)`, filtre apenas linhas cujo recibo parseado tenha `receiptKind(rcpt) === "verify"`!

3. `src/eval.ts`:
   - Em `evalPlan`:
     - Separe `allTaskReceipts` (todos da task) e `verifyReceipts = allTaskReceipts.filter(r => receiptKind(r) === "verify")`.
     - Se `verifyReceipts.length === 0`, `sem recibos para <task>`, exit 1.
     - `status`, `attempts`, `minutes` e `executor` vêm de `verifyReceipts` (e `lastVerify = verifyReceipts[verifyReceipts.length - 1]!`).
     - `tokens = summarizeTokens(allTaskReceipts)` (soma todos os recibos da task, incluindo `judge`!).
     - `judgeReceipts = allTaskReceipts.filter(r => receiptKind(r) === "judge")`.
     - Se `judgeReceipts.length > 0`, `parecer = judgeReceipts[judgeReceipts.length - 1]!.summary` (tem precedência inclusive sobre a regra de mesma família da T07!). Senão, mantém a regra da T07.

4. `src/family.ts`:
   - Siga estritamente os itens 1 a 5 de `tasks/T08/RED.md` (`FAMILY_ALIASES`, `modelFamily`, `normalizeServedId`, `servedFromModels`, `attestFromEndpoint`, `attestFromTranscript`).

5. `src/judge.ts`:
   - Siga estritamente os itens 6 a 10 de `tasks/T08/RED.md` (`JUDGE_EXIT`, `JUDGE_PROMPT_VERSION`, `assertDistinctFamily`, `parseVerdict`, `judgePlan`).
   - Atenção aos detalhes dos casos 10–23 de `tests/judge.test.ts`:
     - Passo 4 (executor): se `opts?.usageFile ?? process.env.PINGA_USAGE_FILE` estiver definido e legível e `attestFromTranscript` retornar `ok: true`, o modelo do executor passa a ser `attested.served` e sua família `modelFamily(attested.served)`. Caso contrário, `execModel = last.author.model` e `execFamily = execModel ? modelFamily(execModel) : last.author.family`.
     - Se `!execFamily || execFamily === "unknown"`, **ANTES** de chamar `attestFromEndpoint` (0 requisições de rede!), grave o recibo `blocked`/`model_unattested` com `summary: \`\${task} blocked: família do executor desconhecida\`` e retorne `8`.
     - Senão, chame `await attestFromEndpoint(endpoint, claimedJudge)`.
       - Se `!attestRes.ok`:
         - se `attestRes.reason_code === "model_unattested"`, grave recibo `blocked`/`model_unattested` (`summary: \`\${task} blocked: modelo do juiz não atestado (\${attestRes.error})\`.slice(0, 280)`), retorne `8`.
         - se `"infra"`, grave recibo `not run`/`infra` (`summary: \`\${task} not run: juiz indisponível (\${attestRes.error})\`.slice(0, 280)`), retorne `8`.
     - Com `attested = attestRes.attested`: `judgeFam = modelFamily(attested.served)`.
     - Chame `assertDistinctFamily(execFamily, judgeFam)`. Se `!dist.ok` (`same_family_judge`), **sem chamar o chat**, grave recibo `blocked`/`same_family_judge` com `model_attested: attested`, `verified_by: null`, `summary: \`\${task} blocked: juiz \${attested.served} é da mesma família do executor (\${judgeFam})\`.slice(0, 280)`, retorne `7`.
     - Chamada ao chat (`POST ${endpoint}/v1/chat/completions`):
       - Monte `diff` com `git diff --no-renames ${baseSha}` (corte por bytes UTF-8 se exceder `maxDiffBytes`, anexando `\n[diff cortado em ${maxDiffBytes} bytes]`).
       - `request = { model: attested.served, temperature: 0, messages: [{ role: "system", content: ... }, { role: "user", content: ... }] }`.
       - Se o `fetch` do chat falhar ou HTTP `!res.ok`, grave recibo `not run`/`infra` com `model_attested: attested`, retorne `8`.
       - Grave `runs/${task}/judge-${judgeN}.json` com `canonicalJson({ request, response_content: rawContent })`.
       - Parseie o veredito com `parseVerdict(rawContent)`. Se `!verdictRes.ok`, grave recibo `not run`/`infra` (com `evidence[0]` apontando para `runs/${task}/judge-${judgeN}.json` com `exit: null` e `model_attested: attested`), retorne `8`.
       - Se `verdictRes.ok`:
         - `pass`: `status: "pass"`, `reason_code: null`, `verified_by: { model: attested.served, family: judgeFam }`, `model_attested: attested`, `summary: \`\${task} pass: juiz \${attested.served} (\${judgeFam}) aprovou\``, exit `0`.
         - `fail`: `status: "fail"`, `reason_code: "judge_rejected"`, `verified_by: { model: attested.served, family: judgeFam }`, `model_attested: attested`, `summary: \`\${task} fail: juiz \${attested.served} (\${judgeFam}) reprovou (\${verdictRes.findings.length} achados)\``, exit `1`.

6. `src/cli.ts` e `bin/pinga.ts`:
   - `runCli(argv: string[]): number | Promise<number>`
   - `bin/pinga.ts`: `process.exitCode = await runCli(process.argv.slice(2));`
   - Adicione subcomando `judge <PLAN.md> [--ledger PATH] [--judge-model M] [--endpoint URL] [--base SHA] [--usage-file PATH]`.

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato: `bun test tests/judge.test.ts`
2. Rode a suíte inteira: `bun test`
3. Confirme que `tests_frozen` não mudou desde o commit RED `76a851d`:
   `git diff 76a851d..HEAD -- tests/judge.test.ts tests/receipt.test.ts tests/eval.test.ts tests/tokens.test.ts tests/breaker.test.ts tests/guards.test.ts tests/verify.test.ts tests/ledger.test.ts tests/repo.test.ts`
4. Commit GREEN:
   ```bash
   git add src/family.ts src/judge.ts src/receipt.ts src/breaker.ts src/eval.ts src/cli.ts bin/pinga.ts
   git commit -m "feat(T08): juiz de família distinta e atestado de modelo (I10 / I11)" -m "Co-Authored-By: glm-5.3-flash-free <noreply@zhipuai.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Cole a saída de `bun test tests/judge.test.ts`, `bun test`, o sha do commit GREEN e `git diff --stat 76a851d..HEAD`. Depois PARE.
