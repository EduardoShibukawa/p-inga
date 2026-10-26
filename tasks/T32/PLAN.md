---
mode: padrao
goal: "Gira-G Self-Dogfooding, Public Docs Portal UX Overhaul, and MCP gira_ask with Caveman format: relative/file:// repos, non-interactive git, root gira.yaml dogfooding, full-width landing, collapsible sidebar docs, and internal/ask with caveman token reduction."
done_when: "cd ../gira-g && go test ./internal/gitcache ./internal/manifest ./internal/docsite ./internal/ask ./internal/mcp ./internal/tools ./cmd/gira && cd ../p-inga && bun test"
touch: ["../gira-g/internal/gitcache/cache.go", "../gira-g/internal/manifest/manifest.go", "../gira-g/cmd/gira/main.go", "../gira-g/gira.yaml", "gira.yaml", "../gira-g/internal/docsite/landing.go", "../gira-g/internal/docsite/builder.go", "../gira-g/internal/ask/ask.go", "../gira-g/cmd/gira/ask.go", "../gira-g/internal/tools/registry.go", "../gira-g/internal/mcp/server.go", "../gira-g/internal/mcp/server_test.go"]
---
## Passos
- [ ] RED: Teste unitário para URLs relativas/file://., MCP gira_ask e formato caveman
- [ ] GREEN: Implementar suporte a file://., git não-interativo e gira init --force
- [ ] GREEN: Configurar gira.yaml em gira-g e p-inga para dogfooding nativo
- [ ] GREEN: Atualizar docsite (landing sem sidebar e colapso de grupos inativos)
- [ ] GREEN: Implementar pacote internal/ask e registrar gira_ask com caveman no MCP
- [ ] GREEN: Validar testes de regressão de gira-g e p-inga
- [ ] GREEN: Selar recibo no ledger P-Ingá e notificar Discord
## Exemplos (gerados antes do código)
1. in: ResolveCloneURL("file://.", "/path/to/repo") -> "file:///path/to/repo"
2. in: mcp.CallTool("gira_ask", {query: "fluxo", format: "caveman"}) -> 1 fato por linha (redução de tokens)
3. in: renderSidebarNav(groups, "intro.html") -> apenas o grupo ativo marcado como open
## Dívidas conscientes / Fora
- Conexão MCP via transportes remotos HTTP/SSE (escopo restrito a stdio e CLI)
