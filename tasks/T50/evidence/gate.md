# T50 — Gate adversarial da spec 0008

Base: worktree `p-inga-ux` (branch `task/ux-unificado`, base `0899228`).
Método: cada âncora `arquivo:linha` do inventário T49 foi aberta (`sed -n 'N-4,N+6p'`) e
confrontada com a claim da spec. Claim sem sustentação na linha ⇒ `reframe`/`drop`.
Também foram executados: `bun bin/pinga.ts docs eval docs` (T1, reproduzido),
`sed -n '29,52p' src/cli.ts | wc -l` → 24 (T2), `grep -c 'aria-' web/index.html` → 0 (W6).

Regra aplicada: critério de aceite que não é verificável por teste/comando determinável
⇒ `reframe` com critério reescrito na spec. Achado cuja âncora existe e sustenta a claim
⇒ `keep`. Nenhum achado novo foi inventado; nenhum foi apagado em silêncio.

## Tabela de vereditos

| ID | Veredito | Motivo |
| --- | --- | --- |
| W1 | keep | `web/index.html:1526` é `await res.json()` sem `res.ok`; `:1533` imprime `Exit ${result.exitCode}`, que é `undefined` em body de erro. Claim e critério batem. |
| W2 | reframe | `web/server.ts:790` devolve `{ success: true, stub: true }` — claim correta. Mas o critério exigia "a UI desabilita o botão" e `grep 'action/session' web/index.html` = 0: não existe botão de sessão no painel. Critério reescrito para 501 + ausência de `success: true` + ausência de chamador no painel. |
| W3 | keep | `web/server.ts:564` monta `Status: Em execução em sessão isolada` no ramo em que nenhum processo é spawnado (o `spawn` só existe no ramo `opencode` das linhas 550-559); `web/index.html:1568` mostra via `alert()`. Critério testável (`simulated: true`, ausência da frase no payload). |
| W4 | keep | `web/index.html:933`, `:1101` e `:1432` só fazem `console.error`; `web/server.ts:62` é `} catch {}` vazio. Quatro âncoras confirmadas. |
| W5 | reframe | Âncoras boas (`web/server.ts:156` devolve `receipts: []` sem abrir o banco; `web/index.html:952` diz "Nenhum recibo corresponde aos filtros ativos"). Mas o critério mandava o painel sugerir `pinga ledger init` — comando inexistente (`grep 'ledger init' src/cli.ts` = 0). Critério reescrito para o caminho real do ledger + `pinga verify <PLAN.md>`, que é quem cria o banco via `openLedger`. |
| W6 | reframe | Âncoras confirmadas: `aria-` = 0 ocorrências e `<h1` = 0; `web/index.html:401` é `<h2>`. O critério pedia "`axe` sem violações críticas", mas `axe` não é dependência do repo (`grep axe package.json` = 0) e o resultado não é determinável no harness offline. Critério trocado por asserções estruturais de DOM. |
| W7 | keep | `web/index.html:892` interpola `${log.text}` dentro de `innerHTML` (linhas 889-893). Injeção/escape é real e testável com `<img onerror>`. |
| W8 | keep | `web/server.ts:104` responde `Access-Control-Allow-Origin: *` no preflight com `POST` liberado; `:590` expõe `POST /api/action/reset-breakers` sem autenticação, e `:582` repete o CORS curinga na resposta. |
| W9 | keep | `web/server.ts:13` fixa `/home/shibuka/Projetos/duh-homelab/gira-g/.gira/macro-map.json`; `:551` fixa o binário do opencode em `mise/installs/opencode/latest/...`. Falha silenciosa em outra máquina, como a claim diz. |
| W10 | reframe | `web/index.html:844` no `onerror` só troca o badge para "Reconectando..." (sem backoff, sem staleness — `grep 'última' web/index.html` = 0); `web/server.ts:464` espera o stdout inteiro do verify (`await new Response(proc.stdout).text()`), bloqueando o painel. O terceiro item do critério ("verificação longa emite progresso") não tem âncora nem payload de progresso: reescrito como heartbeat de SSE ≤5s, que é o mínimo determinável. |
| W11 | keep | `web/index.html:1495` (`alert('Selecione um plano PLAN.md')`), `:1583` (`confirm(...)` no reset de breakers) e `:1592` (`alert(result.message ...)`) confirmam diálogos nativos; `grep -c 'alert('` = 6. Critério ajustado para cobrir também `confirm(`. |
| W12 | keep | `web/server.ts:26` declara `let consecutiveReadsCount = 0` em memória; `:297` publica `consecutive_reads`/`threshold: 3` em `/api/breakers`. Volatilidade após restart é consequência direta. |
| T1 | keep | Reproduzido: `bun bin/pinga.ts docs eval docs` → `EISDIR: illegal operation on a directory, read` com stack trace em `src/cli.ts:1233` (`readFileSync(targetFile)`); o usage de `:52` não diz que o alvo é arquivo. |
| T2 | keep | `src/cli.ts:1268` é `console.error(USAGE)` no fim do `runCli`; `USAGE` vai de `:29` a `:52`, exatamente 24 linhas (`sed -n '29,52p' | wc -l` = 24). Nenhuma menção ao token rejeitado. |
| T3 | keep | `package.json:10` é `"test": "bun test"` — único script; nenhuma ocorrência de `pinga web`/`pinga dashboard` em `src/cli.ts`; a única receita é `docs/SYSTEM_INTEGRATION_SPEC.md:982` (`nohup bun run /home/shibuka/.../web/server.ts > /tmp/pinga-web.log`). |
| D1 | keep | `docs/guides/quickstart.md:16` = `bun .pinga/pinga-stable doctor`; o mesmo caminho fantasma aparece em `:32`, `:49` e `docs/concepts/ledger.md:55` (a claim citava 2 ocorrências; são 4). `.pinga/` não existe (`ls -a`). |
| D2 | keep | `docs/concepts/invariants.md:32` é `I20 \| Discord Observability`; `docs/intro.md:38` põe `DISCORD["Notify Discord (#hermes / dev)"]` no diagrama canônico. Escopo preservado: só remoção da promessa da doc, nada de mensageria. |
| D3 | keep | `docs/concepts/invariants.md:24` lista `rapido`, `padrao`, `rigido`; `src/mode.ts:7` define `["mvp", "padrao", "completo"]`. Comparação de listas é testável por import. |
| D4 | reframe | A obsolescência se confirma (`README.md:3` = "Esqueleto do `p-inga`: Core + Ledger v0.1", e `raw/`/`state/` não existem no repo). A parte "duplicado com `docs/intro.md:9`" **não** se sustenta: `docs/intro.md:9` é uma frase de posicionamento e o corpo do README (raw/state/runs, mise, pre-commit) não tem correspondente no intro; "zero duplicação de corpo" também não é mensurável. Achado e critério reescritos para obsolescência verificável (caminhos, versão, comandos). |
| D5 | reframe | `docs/intro.md:41` é `[Quickstart Guide](guides/quickstart.html)` — link relativo sem `./`, mas resolve na raiz. A parte principal da claim (nav apontando para `./cli/index.html` com `cli/` vazio) veio de uma geração que não está no repo: não existe `docs/cli/`, não existe `runs/docs-preview/`, e `gira.yaml` não declara nav. Evidência não reproduzível ⇒ recortado para checador de links internos, que é determinável. |

## Reframes aplicados na spec (diff semântico)

| ID | Antes | Depois |
| --- | --- | --- |
| W2 | 501 + "UI desabilita o botão" | 501 com `error: "não implementado"`; nenhum caminho com `success: true`; painel não chama `/api/action/session`. |
| W5 | UI cita `pinga ledger init` | UI mostra o caminho resolvido do ledger + `pinga verify <PLAN.md>` (comando que cria o banco). |
| W6 | "`axe` sem violações críticas" | `<h1>` único, landmarks `<main>`/`<nav>`, `aria-live` no resultado de ação, abas com `role=tab`/`aria-selected`, asserção de DOM. |
| W10 | "+ verificação longa emite progresso" | Heartbeat SSE ≤5s com o verify pendente + backoff exponencial com teto + "última atualização há Ns". |
| D4 | "zero duplicação de corpo com `docs/intro.md`" | Caminhos citados existem, versão = `package.json`, todo comando `bun …` do README executa, detalhe delegado a `docs/`. |
| D5 | Nav de `cli/` vazio + link não reescrito | Checador de links: todo link interno de `docs/` resolve no docsite gerado; build falha em link morto. |

Ajustes de critério sem mudança de veredito: W11 passou a exigir zero `confirm(` além de
zero `alert(`; D2 passou a exigir `grep -ri discord docs/` vazio fora do anexo histórico.

## Descartados

Nenhum `drop`: as 20 âncoras existem nos arquivos e sustentam ao menos a claim central.
Nenhum `merge`: os pares candidatos (W1/W4, W6/W11) têm causa e teste distintos — W1 é
`res.ok` de uma ação, W4 é erro de carregamento de dados; W6 é estrutura de página, W11 é
diálogo nativo bloqueante.

## Distribuição nos planos de execução

| Task | cobre | superfície |
| --- | --- | --- |
| T51 | W1, W2, W3, W4, W5 | dados e ações do painel (`web/`) |
| T52 | W6, W7, W8, W9, W10, W11, W12 | segurança, acessibilidade e estado ao vivo (`web/`) |
| T53 | T1, T2, T3, D1, D2, D3, D4, D5 | linha de comando e docs (`src/cli.ts`, `docs/`, README) |

20 IDs, cobertura disjunta e completa (5 + 7 + 8). Três tasks, como o `PLAN.md` da T50 declara em
`touch`. A doc ficou junto da CLI (T53) em vez de uma T40 própria: são a mesma superfície — o que a
pessoa lê e o que ela digita — e uma quarta task sairia do `touch` declarado pela T50.

## Discord

Fora de escopo por decisão do operador. D2 só retira a promessa da doc ativa
(`invariants.md` I20 e o nó do diagrama em `intro.md`); `src/discord-bot.ts` e
`src/discord-bridge.ts` são untracked e permanecem intocados.
