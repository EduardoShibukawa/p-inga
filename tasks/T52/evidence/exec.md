# T52 — evidência de execução (hardening do painel: W6–W12)

Worktree: `/home/shibuka/Projetos/duh-homelab/p-inga-ux`. Sem commit.
Toolchain: `/home/shibuka/.local/share/mise/installs/bun/1.4.4/bin/bun`.

## 1. RED — teste escrito antes do hardening

`tests/ux_t52_hardening.test.ts` rodou contra o painel original. Primeiras falhas,
literalmente (19 falhas no total):

```text
(fail) T52 · W6 estrutura semântica e acessível > exatamente um <h1> no documento [0.37ms]
(fail) T52 · W6 estrutura semântica e acessível > landmarks main e nav existem [1.59ms]
(fail) T52 · W6 estrutura semântica e acessível > abas expõem role=tab e aria-selected [0.37ms]
(fail) T52 · W6 estrutura semântica e acessível > resultado da verificação é região viva (aria-live=polite) [0.97ms]
(fail) T52 · W6 estrutura semântica e acessível > HTML servido pelo painel também tem um único h1 [11.02ms]
(fail) T52 · W7 render sem injeção > appendLog injeta <img onerror> como texto e nada executa [3.17ms]
...
 1 pass
 19 fail
 1 error
 24 expect() calls
Ran 20 tests across 1 file. [5.25s]

EXIT=1
```

Exit code: `1`.

## 2. GREEN — done_when

```text
$ bun test tests/ux_t52_hardening.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t52_hardening.test.ts:
(pass) T52 · W6 estrutura semântica e acessível > exatamente um <h1> no documento [0.15ms]
(pass) T52 · W6 estrutura semântica e acessível > landmarks main e nav existem [0.11ms]
(pass) T52 · W6 estrutura semântica e acessível > abas expõem role=tab e aria-selected [0.12ms]
(pass) T52 · W6 estrutura semântica e acessível > resultado da verificação é região viva (aria-live=polite) [0.08ms]
(pass) T52 · W6 estrutura semântica e acessível > HTML servido pelo painel também tem um único h1 [6.45ms]
(pass) T52 · W7 render sem injeção > appendLog injeta <img onerror> como texto e nada executa [0.80ms]
(pass) T52 · W7 render sem injeção > log.text nunca é interpolado em innerHTML [0.23ms]
(pass) T52 · W7 render sem injeção > mensagens de erro de rede também usam textContent [0.08ms]
(pass) T52 · W8 CORS restrito à origem do painel > POST de origem estranha recebe 403 [1.43ms]
(pass) T52 · W8 CORS restrito à origem do painel > POST da própria origem é aceito [1.32ms]
(pass) T52 · W8 CORS restrito à origem do painel > nenhuma resposta publica Allow-Origin curinga [1.15ms]
(pass) T52 · W9 configuração por env, sem caminho de máquina > GIRA_MAP, OPENCODE_BIN e LEDGER_PATH são lidos do ambiente [0.12ms]
(pass) T52 · W9 configuração por env, sem caminho de máquina > defaults são relativos à raiz e não há /home/ hardcoded [0.09ms]
(pass) T52 · W9 configuração por env, sem caminho de máquina > /api/graph avisa quando o mapa gira está ausente [1.16ms]
(pass) T52 · W10 estado ao vivo confiável > SSE emite heartbeat em até 5s [2002.01ms]
(pass) T52 · W10 estado ao vivo confiável > painel mostra idade da última atualização e backoff com teto 30s [0.24ms]
(pass) T52 · W11 sem alert/confirm nativos > index.html não usa alert() nem confirm() [0.30ms]
(pass) T52 · W11 sem alert/confirm nativos > toast + histórico existem no painel [0.15ms]
(pass) T52 · W12 contador de leituras persistido > duas leituras persistem em .pinga/readings.json e sobrevivem a restart [67.66ms]
(pass) T52 · W12 contador de leituras persistido > reset-breakers zera o contador persistido [27.51ms]
[p-inga web] falha ao fechar cliente SSE: Invalid state: Controller is already closed

 20 pass
 0 fail
 61 expect() calls
Ran 20 tests across 1 file. [2.13s]
```

Exit code: `0`.

O aviso de teardown do stream SSE (`[p-inga web] falha ao fechar cliente SSE:
Invalid state: Controller is already closed`) aparece no log real e é caminho de erro
do encerramento, não falha de teste.

## 3. Gate de cobertura preservado

```text
$ bun test tests/ux_t50_gate.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t50_gate.test.ts:
(pass) T50 · gate adversarial da spec 0008 > spec aprovada e todo achado com veredito no gate.md [0.80ms]
(pass) T50 · gate adversarial da spec 0008 > tasks de execucao declaram cobertura disjunta e completa [0.52ms]
(pass) T50 · gate adversarial da spec 0008 > done_when existe e nenhum touch aponta para arquivo de codigo fantasma [0.33ms]

 3 pass
 0 fail
 83 expect() calls
Ran 3 tests across 1 file. [7.00ms]
```

Exit code: `0`.

## 4. Arquivos tocados

- `web/index.html` — `<h1>` único, `<main>`/`<nav>`, abas com `role=tab`/`aria-selected`,
  resultado em `aria-live="polite"`, `appendLog` só com `textContent`, toast stack com
  histórico (sem `alert()`/`confirm()`), idade da última atualização e backoff com teto
  de 30s.
- `web/server.ts` — CORS aceitando apenas a origem do painel (403 para origem estranha,
  nunca `Allow-Origin` curinga), heartbeat SSE de 2s com limpeza por stream,
  `.pinga/readings.json` persistido (sobrevive a restart e a `reset-breakers`), config
  por env (`GIRA_MAP`, `OPENCODE_BIN`, `LEDGER_PATH`) sem `/home/` cravado.
- `tests/ux_t52_hardening.test.ts` — criado (20 testes).

## 5. Notas

- O teste de heartbeat mede tempo real (~2s) e tem timeout de 20s.
- `readings.json` é gravado sob `cfg.root` — temporário nos testes, nunca no repo.
