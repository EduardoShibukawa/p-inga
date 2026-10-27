---
mode: padrao
goal: "aviso do vigia no Discord só com task acionável: notice = apenas as transições para done/blocked/invalid_plan/awaiting_receipt (uma linha cada) + linha curta de contagem; superseded/open/leased não avisam; sem transição acionável o vigia não manda nada"
touch:
  - src/queue.ts
  - src/cli.ts
done_when: "bun test tests/queue_notify_acionavel.test.ts"
tests_frozen: ["tests/queue_notify_acionavel.test.ts"]
---
# T60: vigia manda o digest inteiro no Discord (flood)

O vigia roda a cada 5 min com `--notify` e, a cada transição avisável (inclusive
`superseded`), envia o digest COMPLETO: contagens + uma linha por task (55 hoje).
O operador só precisa do que terminou e do que está parado esperando ação dele.

Correção: `queue` expõe `notice` (o texto que vai para o Discord) no JSON e no
fluxo `--notify`; `null` quando nada é acionável, senão só as tasks que
transicionaram para estado acionável, com reason_code, e uma linha de contagem.
`superseded`, `open` e `leased` saem de `NOTIFY_STATES`.

Teste congela: `open -> done` não cita as paradas; bloqueio aparece com estado;
duas rodadas sem mudança ⇒ `notice: null`; `superseded` fora de `NOTIFY_STATES`.
