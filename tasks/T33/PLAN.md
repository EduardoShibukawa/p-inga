---
mode: padrao
goal: "Multi-Project Living Docsite Builder and P-Inga GitHub Pages: dynamic target branding/logo/GitHub metadata, MacroMap diagram synthesis, README fallback, and automated docs workflow on both repos."
done_when: "cd ../gira-g && go test ./internal/docsite ./cmd/gira && cd ../p-inga && bun test"
touch: ["../gira-g/cmd/gira/docs_cmd.go", "../gira-g/internal/docsite/types.go", "../gira-g/internal/docsite/landing.go", "../gira-g/internal/docsite/builder.go", ".github/workflows/docs.yml", "docs/intro.md", "docs/guides/quickstart.md", "docs/concepts/invariants.md", "docs/concepts/ledger.md"]
---
## Passos
- [ ] RED: Teste em docsite exigindo metadados dinâmicos de projeto e fallback README
- [ ] GREEN: Implementar configuração dinâmica e síntese no docsite builder de gira-g
- [ ] GREEN: Criar documentação e workflow GitHub Pages (.github/workflows/docs.yml) em p-inga
- [ ] GREEN: Gerar docsite completo de p-inga e validar layout sem erros
- [ ] GREEN: Validar testes de regressão de gira-g e p-inga
- [ ] GREEN: Selar recibo no ledger P-Ingá e notificar Discord
## Exemplos (gerados antes do código)
1. in: docsite.NewBuilder(cfgWithTargetPinga) -> index.html branding 'P', title 'p-inga', GitHub p-inga
2. in: builder.Build() sem docs/intro.md mas com README.md -> gera intro.html a partir do README
3. in: p-inga/docs/guides/quickstart.md -> avaliado com nota >= 85 no benchmark
## Dívidas conscientes / Fora
- CDN customizada fora do GitHub Pages (foco em gh-pages nativo com actions/deploy-pages@v4)
