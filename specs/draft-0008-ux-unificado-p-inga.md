# Spec 0008 — UX unificado do p-inga

Status: approved

## Contexto
O p-inga hoje tem três superfícies de operador (dashboard web :4242, CLI/TUIOS, docsite `gira docs`) com contratos de feedback diferentes e nenhum inventário único de defeitos de uso. O inventário `tasks/T49/evidence/inventory.md` registra 20 achados ancorados; esta spec os prioriza e define o critério de aceite verificável de cada um.

## Superfícies cobertas
- **web/** — `web/index.html` (painel, SSE, tabelas, ações) e `web/server.ts` (`/api/*`, `/api/action/*`).
- **tuios** — `src/adapters/tuios.ts`, `src/cli.ts` (usage, erros) e o entrypoint real `bin/pinga.ts`.
- **docs/** — `docs/**` fonte e o docsite gerado por `gira docs`.
- Caneta e papel do operador: receber estado verdadeiro, erro acionável e próximo comando óbvio.

## Achados priorizados e critério de aceite
Cada linha cita a âncora do inventário; o critério é o que a execução precisa provar.
O veredito de cada achado (keep/reframe) e a âncora aberta estão em `tasks/T50/evidence/gate.md`.

| ID | Sev | Achado (âncora) | Critério de aceite |
| --- | --- | --- | --- |
| W1 | P0 | Falha HTTP vira bloqueio de verificação (`web/index.html:1526`) | Com servidor em 500 ou offline, o painel mostra banner "servidor indisponível" e nunca "Exit undefined"; teste cobre `res.ok === false`. |
| W2 | P0 | Controle de sessão devolve sucesso stub (`web/server.ts:790`) | Endpoint responde 501 com erro "não implementado" e nenhum caminho de `/api/action/session` retorna `success: true`; teste cobre o POST e garante que `web/index.html` não chama a rota (o painel não tem controle de sessão para desabilitar). |
| W3 | P0 | Dispatch simulado como execução real (`web/server.ts:564`) | Resposta inclui `simulated: true` e a UI rotula "simulação — nada foi executado"; teste garante ausência de "Em execução". |
| W4 | P1 | Erros só em `console.error` (`web/index.html:933`) | Toda chamada `fetch` do painel renderiza erro visível com horário e botão "tentar de novo"; `catch {}` vazio eliminado de `web/server.ts:62`. |
| W5 | P1 | Vazio "sem ledger" tratado como filtro (`web/server.ts:156`) | Sem `ledger.db`, a UI mostra "ledger ausente" com o caminho resolvido do ledger e o comando real que o cria (`pinga verify <PLAN.md>`); o texto de filtro só aparece com banco presente. |
| W6 | P1 | Sem `aria-*` nem `<h1>` (`web/index.html:401`) | Página tem um único `<h1>`, landmarks `<main>`/`<nav>`, `aria-live` no resultado de ação e abas com `role=tab`/`aria-selected`; teste de DOM falha se faltar qualquer um (sem `axe`: não é dependência do repo). |
| W7 | P1 | Log injetado via `innerHTML` (`web/index.html:892`) | Texto de log renderizado com `textContent`; teste com `<img onerror>` não executa e não quebra layout. |
| W8 | P1 | CORS `*` em `/api/action/*` (`web/server.ts:104`) | `Access-Control-Allow-Origin` restrito a `http://localhost:4242`; `POST` de origem estranha recebe 403. |
| W9 | P1 | Caminhos absolutos de outra máquina (`web/server.ts:13`) | Caminhos vêm de env com default relativo; painel inicia em clone limpo sem erro de grafo e informa o que configurar. |
| W10 | P1 | SSE sem backoff nem staleness (`web/index.html:844`) | Badge mostra estado + "última atualização há Ns" a partir do último evento; reconexão com backoff exponencial e teto; `/api/events` emite heartbeat a cada ≤5s mesmo com `verify` pendente. |
| W11 | P2 | `alert()`/`confirm()` bloqueantes (`web/index.html:1495`) | Feedback inline/toast com histórico no painel; zero `alert(` e zero `confirm(` no arquivo. |
| W12 | P2 | Contador de breaker volátil (`web/server.ts:26`) | Contador persiste no ledger e o header mostra a fonte do número; após restart o valor não volta a 0/3. |
| T1 | P0 | `docs eval <dir>` estoura EISDIR (`src/cli.ts:1233`) | Alvo diretório varre os `.md` ou retorna erro de uso em uma linha; nunca imprime stack trace; teste cobre diretório. |
| T2 | P1 | Comando inválido despeja USAGE (`src/cli.ts:1268`) | Erro nomeia o token rejeitado, sugere comando próximo e imprime 3 linhas, não as 24 do usage. |
| T3 | P1 | Dashboard sem entrypoint (`package.json:10`) | `pinga web` sobe o painel e aparece no usage (`src/cli.ts:52`); README e quickstart usam esse comando. |
| D1 | P0 | Onboarding manda binário inexistente (`docs/guides/quickstart.md:16`) | Quickstart e ledger usam `bun bin/pinga.ts`; script de doc testa cada comando e falha se o caminho não existir. |
| D2 | P0 | Discord como invariante obrigatório (`docs/concepts/invariants.md:32`) | I20 e o nó do fluxo (`docs/intro.md:38`) saem para `docs/appendix/`; `grep -ri discord docs/ --exclude-dir=appendix` vazio e o docsite gerado não cita discord como passo obrigatório. |
| D3 | P1 | Modos divergem doc × código (`docs/concepts/invariants.md:24`) | Doc lista `mvp`, `padrao`, `completo` igual a `src/mode.ts:7`; teste compara as duas listas. |
| D4 | P1 | README obsoleto: v0.1 e diretórios inexistentes (`README.md:3`) | Todo caminho em crase no README existe (`raw/` e `state/` saem), a versão citada bate com `package.json` e todo comando `bun …` do README executa; detalhe delegado a `docs/`. |
| D5 | P2 | Docsite sem checagem de link interno (`docs/intro.md:41`) | Todo link interno de `docs/` resolve no docsite gerado e o build falha em link morto; link do intro normalizado para `./guides/quickstart.html`. |

## Fora de escopo
- **discord** e o protótipo untracked de bot: plataforma desabilitada e declarada fora de escopo, sem contrato de UX nesta rodada. Achado D2 apenas remove a promessa da doc; nenhuma superfície de mensageria é construída, corrigida ou testada aqui.
- Redesign visual completo (identidade, dark/light) e i18n.

## Tasks de execução propostas
Cobertura disjunta e completa dos 20 IDs: 5 + 7 + 8.
- **T51 — dados honestos no painel** (`tasks/T51/PLAN.md`). cobre W1, W2, W3, W4, W5. done_when: `bun test tests/ux_t51_feedback.test.ts` verde; POST em `/api/action/session` e comando inexistente devolvem erro real (sem `success: true`, sem "Em execução").
- **T52 — render seguro e acessível** (`tasks/T52/PLAN.md`). cobre W6, W7, W8, W9, W10, W11, W12. done_when: DOM com `<h1>` único, landmarks e `aria-live`; log escapado; CORS restrito com 403 testado; caminhos por env; heartbeat SSE e contador de leituras persistido.
- **T53 — CLI e docs acionáveis** (`tasks/T53/PLAN.md`). cobre T1, T2, T3, D1, D2, D3, D4, D5. done_when: `pinga docs eval docs` sem stack trace, comando inválido em ≤3 linhas, `pinga web` subindo :4242, nenhum `.pinga/pinga-stable` em `docs/`, I20 no anexo, modos iguais a `src/mode.ts`, README sem caminho fantasma e docsite sem link morto.
