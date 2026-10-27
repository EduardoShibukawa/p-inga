# T49 — Inventário de UX do p-inga

Base: worktree `p-inga-ux` (branch `task/ux-unificado`, base `0899228`).
Método: leitura direta de código/doc + execução real da CLI e da geração do docsite.
Cada achado traz âncora `arquivo:linha`, evidência observada e dimensão de UX afetada.

---

## 1. Superfície web/ (dashboard :4242, SSE `/api/events`, `/api/action/*`)

### W1 — P0 — Falha de servidor é relatada ao operador como bloqueio de verificação
`web/index.html:1526` faz `await res.json()` sem checar `res.ok`; `web/index.html:1533` renderiza o resultado com `Exit undefined`.
Servidor fora do ar ou 500 vira "FALHA / BLOQUEIO (Exit: undefined)" em vez de erro de transporte.
**Dimensão:** feedback de ação, confiança no status.

### W2 — P0 — Controle de sessão é stub e devolve sucesso falso
`web/server.ts:790` responde `{ success: true, stub: true }` para controle de sessão sem executar nada.
Qualquer consumidor do endpoint recebe "sucesso" de uma ação que não existe: não há como distinguir stub de execução real pela resposta.
**Dimensão:** feedback de ação (mentira de status).

### W3 — P0 — "Dispatch" simulado apresenta-se como execução real
`web/server.ts:564` monta saída textual com "Status: Em execução em sessão isolada" sem processo algum; `web/index.html:1568` mostra isso em `alert()` bloqueante.
**Dimensão:** hierarquia de confiança, feedback.

### W4 — P1 — Erros de rede engolidos para o console
`web/index.html:933`, `web/index.html:1101` e `web/index.html:1432` só fazem `console.error`; no watcher do servidor o `catch {}` é vazio em `web/server.ts:62`.
A tabela fica vazia sem banner, sem retry, sem timestamp — indistinguível de "não há dados".
**Dimensão:** erros silenciosos, estado vazio.

### W5 — P1 — Estado vazio não distingue "sem ledger" de "sem resultado no filtro"
Servidor devolve lista vazia quando o banco não existe (`web/server.ts:156`); a UI explica como filtro: "Nenhum recibo corresponde aos filtros ativos" (`web/index.html:952`).
**Dimensão:** estados vazios, onboarding do operador.

### W6 — P1 — Zero suporte a acessibilidade
Nenhum atributo `aria-*` e nenhum `<h1>` no arquivo de 1729 linhas; a hierarquia começa em `<h2>` (`web/index.html:401`).
Leitor de tela não tem landmark nem título de página; abas não expõem `role=tab`.
**Dimensão:** acessibilidade.

### W7 — P1 — Log injetado como HTML sem escape
`web/index.html:892` faz `innerHTML` com `log.text` vindo do ledger/SSE: texto com `<` quebra o layout e permite injeção.
**Dimensão:** robustez de render, segurança de exibição.

### W8 — P1 — API de ações exposta com CORS curinga e sem autenticação
`web/server.ts:104` responde `Access-Control-Allow-Origin: *` com `POST` habilitado em `/api/action/*`: qualquer página aberta no navegador pode resetar breakers e escrever recibo no ledger (`web/server.ts:590`).
**Dimensão:** confiança/segurança percebida, ações destrutivas.

### W9 — P1 — Caminhos absolutos de outra máquina no servidor
`web/server.ts:13` fixa o `macro-map.json` do gira-g em `/home/shibuka/Projetos/duh-homelab/gira-g/...`; `web/server.ts:551` fixa o binário do opencode em `mise/installs/opencode/latest/...`.
Em qualquer outra máquina o grafo e o dispatch falham sem explicar que falta configurar caminho.
**Dimensão:** portabilidade, mensagens de erro.

### W10 — P1 — SSE reconecta sem backoff nem indicador de dado velho
`web/index.html:844` só troca o badge para "Reconectando..."; não há backoff, nem "última atualização", nem sinal de staleness. Verificação longa bloqueia o request inteiro (`web/server.ts:464`), então o painel fica mudo durante minutos.
**Dimensão:** refresh/SSE, densidade temporal.

### W11 — P2 — Feedback por `alert()`/`confirm()` bloqueantes
`web/index.html:1495` e `web/index.html:1592` usam diálogos nativos para confirmar ação destrutiva e reportar resultado; sem histórico, sem cópia, sem acessibilidade.
**Dimensão:** feedback de ação, consistência.

### W12 — P2 — Contador do breaker é volátil e engana no header
`web/server.ts:26` mantém `consecutiveReadsCount` só em memória, exibido em `web/server.ts:297`; após restart mostra `0/3` mesmo com falhas acumuladas.
**Dimensão:** status, confiança no indicador.

---

## 2. Superfície tuios (adaptador + CLI/cockpit do operador)

### T1 — P0 — `pinga docs eval <diretório>` estoura stack trace cru
Reproduzido: `bun bin/pinga.ts docs eval docs` → `EISDIR: illegal operation on a directory, read` a partir de `src/cli.ts:1233`; o usage em `src/cli.ts:52` não diz que o alvo deve ser arquivo único.
Erro de uso vira crash sem mensagem acionável.
**Dimensão:** mensagens de erro.

### T2 — P1 — Comando inválido despeja o USAGE inteiro sem nomear o erro
`src/cli.ts:1268` cai no bloco final imprimindo as 24 linhas de `src/cli.ts:29` sem citar o token rejeitado nem sugerir comando próximo.
**Dimensão:** descoberta de comandos, mensagens de erro.

### T3 — P1 — O dashboard não tem entrypoint descobrível
`package.json:10` declara apenas o script `test`; a única receita de subir o painel é `docs/SYSTEM_INTEGRATION_SPEC.md:982`, com caminho absoluto do checkout `p-inga` e log em `/tmp`.
Não existe `pinga web`/`pinga dashboard` no usage (`src/cli.ts:52`).
**Dimensão:** descoberta, onboarding.

---

## 3. Superfície docs/ (docsite gerado por `gira docs`)

### D1 — P0 — Onboarding manda rodar binário que não existe no repositório
`docs/guides/quickstart.md:16` instrui `bun .pinga/pinga-stable doctor`; não existe diretório `.pinga/` (o entrypoint real é `bin/pinga.ts`). O mesmo caminho fantasma aparece em `docs/concepts/ledger.md:55`.
Passo 1 do quickstart falha para qualquer novo operador.
**Dimensão:** onboarding.

### D2 — P0 — Discord documentado como invariante obrigatório, contra a decisão do operador
`docs/concepts/invariants.md:32` (I20 "Discord Observability") exige dispatch de embeds assinados; `docs/intro.md:38` coloca Discord no diagrama canônico do fluxo.
A docsite ensina um caminho desabilitado.
**Dimensão:** estrutura, veracidade da doc.

### D3 — P1 — Nomes de modo divergem entre doc e código
`docs/concepts/invariants.md:24` lista `rapido`, `padrao`, `rigido`; `src/mode.ts:7` define `mvp`, `padrao`, `completo`. Quem segue a doc escreve frontmatter inválido.
**Dimensão:** onboarding, consistência.

### D4 — P1 — README obsoleto e duplicado com docs/intro
`README.md:3` ainda diz "Esqueleto do `p-inga`: Core + Ledger v0.1", enquanto `src/cli.ts` tem 1274 linhas e o harness está em v0.5+; conteúdo repetido em `docs/intro.md:9` com versão mais nova.
**Dimensão:** estrutura/duplicação.

### D5 — P2 — Docsite expõe seção de CLI vazia e link não reescrito
Geração real com `gira docs -output runs/docs-preview -root .` produziu nav apontando para `./cli/index.html` com `cli/` sem nenhuma página; `docs/intro.md:41` mantém link relativo sem `./`, que só resolve porque a página cai na raiz.
**Dimensão:** links, navegação.

---

## 4. Priorização consolidada

| Severidade | Achados | Tema dominante |
| --- | --- | --- |
| P0 | W1, W2, W3, T1, D1, D2 | feedback falso e onboarding quebrado |
| P1 | W4–W10, T2, T3, D3, D4 | erros silenciosos, descoberta, acessibilidade |
| P2 | W11, W12, D5 | polimento de feedback e navegação |

Contagem: 20 achados (12 web/, 3 tuios, 5 docs/).
