# T37 — evidência de execução (feedback visível do painel: W1–W5)

Worktree: `/home/shibuka/Projetos/duh-homelab/p-inga-ux` (branch `task/ux-unificado`, base `0899228`).
Sem commit, merge, stash ou reset: tudo ficou como adição não commitada.
Toolchain: `/home/shibuka/.local/share/mise/installs/bun/1.4.4/bin/bun`.

## 1. RED — teste escrito antes da implementação

`tests/ux_t37_feedback.test.ts` foi criado primeiro e rodado contra o `web/server.ts`
original, que não exportava fábrica de servidor.

```text
$ bun test tests/ux_t37_feedback.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t37_feedback.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'createDashboardServer' not found in module '/home/shibuka/Projetos/duh-homelab/p-inga-ux/web/server.ts'.
-------------------------------


 0 pass
 1 fail
 1 error
Ran 1 test across 1 file. [32.00ms]
```

Exit code: `1`.

Só depois disso `web/server.ts` passou a exportar `readDashboardConfig(env, root)` e
`createDashboardServer(cfg)`.

## 2. GREEN — done_when

```text
$ bun test tests/ux_t37_feedback.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t37_feedback.test.ts:
(pass) T37 · W1 falha de fetch é visível (status + corpo) > POST inválido em /api/action/verify responde 500 com mensagem legível [9.85ms]
(pass) T37 · W1 falha de fetch é visível (status + corpo) > painel trata !res.ok antes de ler o corpo e nunca imprime 'Exit undefined' [0.52ms]
(pass) T37 · W2 rota stub responde 501 e some do painel > /api/action/session devolve 501 explícito [1.71ms]
(pass) T37 · W2 rota stub responde 501 e some do painel > index.html não referencia a rota stub [0.13ms]
(pass) T37 · W3 dispatch sem opencode é simulação declarada > dispatch sem binário devolve simulated=true e nunca 'Em execução' [1.32ms]
(pass) T37 · W3 dispatch sem opencode é simulação declarada > painel exibe o estado de simulação [0.11ms]
(pass) T37 · W4 nenhum erro é engolido > web/server.ts não tem catch vazio [0.67ms]
(pass) T37 · W4 nenhum erro é engolido > loaders do painel reportam no DOM, não só no console [0.23ms]
(pass) T37 · W5 ledger ausente é estado explícito > /api/receipts informa ausência com caminho e comando de correção [1.68ms]
(pass) T37 · W5 ledger ausente é estado explícito > painel mostra 'ledger ausente' com o caminho resolvido [0.28ms]

 10 pass
 0 fail
 33 expect() calls
Ran 10 tests across 1 file. [40.00ms]
```

Exit code: `0`.

## 3. Gate de cobertura preservado

```text
$ bun test tests/ux_t36_gate.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t36_gate.test.ts:
(pass) T36 · gate adversarial da spec 0008 > spec aprovada e todo achado com veredito no gate.md [0.80ms]
(pass) T36 · gate adversarial da spec 0008 > tasks de execucao declaram cobertura disjunta e completa [0.52ms]
(pass) T36 · gate adversarial da spec 0008 > done_when existe e nenhum touch aponta para arquivo de codigo fantasma [0.33ms]

 3 pass
 0 fail
 83 expect() calls
Ran 3 tests across 1 file. [7.00ms]
```

Exit code: `0`.

## 4. Arquivos tocados

- `web/server.ts` — fábrica exportada (`createDashboardServer`, `readDashboardConfig`),
  config por env, rotas com erro explícito e status real.
- `web/index.html` — banner de conexão, estado de ledger ausente, tratamento de `!res.ok`
  antes de ler o corpo.
- `tests/ux_t37_feedback.test.ts` — criado (10 testes).

## 5. Notas

- `createDashboardServer` aceita `port: 0`; nenhum teste disputa porta fixa.
- Todo teste roda em `mkdtemp` (`PINGA_LEDGER`/`PINGA_LEARN_DB` injetados); o repo real
  nunca é escrito.
