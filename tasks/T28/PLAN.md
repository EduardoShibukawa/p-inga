---
mode: padrao
goal: "Gira-G Docs P0 Alignment & Release v0.3.0 Readiness: fix tour gate-lint flag, universalize quickstart, align navigation with intro.md, update static validator."
done_when: "cd ../gira-g && go test ./... && go run ./cmd/gira docs --output build && cd ../p-inga && bun run src/cli.ts docs eval --strict ../gira-g/build/index.html && bun run src/cli.ts docs eval --strict ../gira-g/build/tour.html && bun test tests/docs_eval.test.ts"
touch: ["../gira-g/internal/docsite/tour.go", "../gira-g/internal/docsite/landing.go", "../gira-g/internal/docsite/builder.go", "src/docs_eval.ts", "tests/docs_eval.test.ts"]
---
## Passos
- [ ] RED: Atualizar docs_eval.ts para capturar 'gira gate --strict' (deve ser gate-lint --strict) e provar falha no tour atual
- [ ] GREEN: Corrigir step 5 do Guided Tour em tour.go para usar 'gira gate-lint --strict'
- [ ] GREEN: Universalizar quickstart em landing.go para comandos portáveis ('gira tour --format md')
- [ ] GREEN: Corrigir navegação em builder.go para destacar intro.html no topo e tratar overview.html legado
- [ ] GREEN: Verificar conformidade total com testes unitários e gerador de documentação
- [ ] GREEN: Selar recibo no ledger P-Ingá e notificar Discord
## Exemplos (gerados antes do código)
1. in: gira gate --strict -> detectado como erro de flag (--strict pertence a gate-lint)
2. in: tour.go Step 5 -> gira gate-lint --strict
3. in: builder.go nav -> 'Intro' como primeiro link sob Getting Started
## Dívidas conscientes / Fora
- Tag v0.3.0 será criada no GitHub após aprovação dos checks do PR no repositório gira-g
