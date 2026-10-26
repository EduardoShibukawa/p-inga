---
mode: padrao
goal: "Docs-Benchmark Framework: build multi-tool documentation benchmark comparing Gira-G, Understand-Anything, Graphify, and static baseline across Human DX, Agent DX, and Engine Ops."
done_when: "cd ../docs-benchmark && bun test && bun run src/cli.ts compare --fixture testdata/microservice --dry-run"
touch: ["../docs-benchmark/package.json", "../docs-benchmark/src/", "../docs-benchmark/testdata/", "../docs-benchmark/README.md"]
---
## Passos
- [ ] RED: Criar suite de testes de contrato para o docs-benchmark (falhando antes da implementação)
- [ ] GREEN: Implementar Runner Headless (sandbox de execução de quickstart e crawler de links quebrados)
- [ ] GREEN: Implementar Probes de Agentes (tarefas de busca factual e métricas de consumo de tokens)
- [ ] GREEN: Implementar Adaptadores dos Competidores (Gira-G, Understand-Anything, Graphify, Static Baseline)
- [ ] GREEN: Implementar Gerador de Scorecard Comparativo (Human DX, Agent DX, Engine Ops, radar chart)
- [ ] GREEN: Criar fixture de microsserviço de teste (Go + TS + configs)
- [ ] GREEN: Verificar todos os testes unitários e rodar dry-run do benchmark
- [ ] GREEN: Selar recibo no ledger P-Ingá e notificar Discord
## Exemplos (gerados antes do código)
1. in: docs-benchmark run --fixture testdata/microservice -> calcula EQR (Executable Quickstart Rate) e token overhead
2. in: competitors: [gira, understand-anything, graphify] -> tabela comparativa gerada em markdown e json
## Dívidas conscientes / Fora
- Integração ao vivo com APIs pagas de terceiros no dry-run (usa mock determinístico / fixtures para isolamento de CI)
