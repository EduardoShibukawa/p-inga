---
mode: padrao
goal: "Gira-G 5-Pillar Architecture & Human-First Transformation: human landing page, gira ask command with Mermaid, and 8-feature docs benchmark."
done_when: "cd ../gira-g && go test ./cmd/gira ./internal/docsite && go run ./cmd/gira docs --output build && cd ../docs-benchmark && bun test && cd ../p-inga && bun run src/cli.ts docs eval --strict ../gira-g/build/index.html"
touch: ["../gira-g/internal/docsite/landing.go", "../gira-g/cmd/gira/ask.go", "../gira-g/cmd/gira/ask_test.go", "../gira-g/cmd/gira/main.go", "../docs-benchmark/src/features/feature_matrix.ts", "../docs-benchmark/tests/benchmark.test.ts"]
---
## Passos
- [ ] RED: Teste em docs-benchmark exigindo 8ª feature (feat-local-first-airgapped) e teste em gira-g exigindo gira ask
- [ ] GREEN: Implementar 8ª feature feat-local-first-airgapped em feature_matrix.ts e validar docs-benchmark
- [ ] GREEN: Implementar comando gira ask em ask.go com fallback offline MacroMap, flag --diagram Mermaid e main.go
- [ ] GREEN: Reformular landing page em landing.go com Hero renovado, 3 cenários práticos e 5 pilares do Gira-G
- [ ] GREEN: Validar testes de ambos os repos e conformidade de docs_eval no index.html gerado
- [ ] GREEN: Selar recibo no ledger P-Ingá e notificar Discord
## Exemplos (gerados antes do código)
1. in: gira ask "qual a arquitetura de persistência?" --diagram -> resposta MacroMap e bloco mermaid graph TD
2. in: FEATURE_MATRIX -> contém 8 features incluindo feat-local-first-airgapped
3. in: landing.go -> Hero 'The Architectural GPS & Surgical Scalpel for Your Codebase' e 3 cenários práticos
## Dívidas conscientes / Fora
- Chamadas a LLMs remotas pagas no gira ask (foco total no fallback local zero-token air-gapped)
