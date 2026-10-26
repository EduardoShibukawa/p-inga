---
mode: padrao
goal: "Human-Centric & Macro-First Documentation: fix quickstart commands, isolate internals/agents, eliminate file:// leaks, workflow tour."
done_when: "cd ../gira-g && go test ./... && go run ./cmd/gira docs --output build && cd ../p-inga && bun run src/cli.ts docs eval --strict ../gira-g/build/index.html && bun run src/cli.ts docs eval --strict ../gira-g/build/architecture/index.html && bun test tests/docs_eval.test.ts"
touch: ["../gira-g/internal/architecture/generator.go", "../gira-g/internal/docsite/landing.go", "../gira-g/internal/docsite/tour.go", "../gira-g/internal/docsite/builder.go", "../gira-g/docs/concepts/"]
---
## Passos
- [x] RED: Identificar falhas de DX e comandos quebrados na documentação pública via auditoria independente
- [x] GREEN: Corrigir gerador de arquitetura em generator.go (remover file://, deduplicar relações, corrigir numeração de seções e locators)
- [x] GREEN: Atualizar Landing Page em landing.go com comandos reais (gira init, gira read <file> <sym>, gira docs) e foco macro de produto
- [x] GREEN: Reformular Guided Tour em tour.go para percurso operacional de adoção do desenvolvedor (Init -> Map -> Slice -> Gate -> MCP)
- [x] GREEN: Reorganizar navegação em builder.go isolando Internals e ADRs da jornada principal
- [x] GREEN: Limpar notas editoriais internas ('Avoid: ...') dos conceitos públicos
- [x] GREEN: Validar geração de build, compilação de testes e selar recibo no ledger
## Exemplos (gerados antes do código)
1. in: gira read cmd/gira/main.go main -> snippet determinístico de código sem erro de flags
2. in: formatCitationLink(repoRoot, loc) -> link relativo ou permalink GitHub sem prefixo file:///home/shibuka
3. in: buildNavigation() -> seções Getting Started, Guides & Workflows, CLI Reference, e Engine Internals recolhida
## Dívidas conscientes / Fora
- Tradução bilíngue completa de todas as páginas em markdown legadas (foco atual na estrutura de produto e DX)
