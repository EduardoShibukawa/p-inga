---
mode: padrao
goal: "Gira-G JEV Semantic Classifier Adapter (internal/jev): Non-deterministic intent routing for gira ask, document role classification, and zero-token local floor."
done_when: "cd ../gira-g && go test ./internal/jev ./cmd/gira && cd ../p-inga && bun test"
touch: ["../gira-g/internal/jev/types.go", "../gira-g/internal/jev/local.go", "../gira-g/internal/jev/runner.go", "../gira-g/internal/jev/classifier.go", "../gira-g/internal/jev/jev_test.go", "../gira-g/cmd/gira/ask.go", "../gira-g/cmd/gira/ask_test.go"]
---
## Passos
- [ ] RED: Teste unitário em internal/jev exigindo classificação de intenções e fallback local
- [ ] GREEN: Implementar pacote internal/jev com types.go, local.go, runner.go e classifier.go
- [ ] GREEN: Conectar internal/jev no comando gira ask (ask.go) substituindo parsing básico de strings
- [ ] GREEN: Validar testes de regressão do CLI e do motor JEV em gira-g
- [ ] GREEN: Selar recibo no ledger P-Ingá e notificar Discord
## Exemplos (gerados antes do código)
1. in: jev.ClassifyIntent("Qual o propósito deste microsserviço?") -> IntentPurpose (confiança >= 0.8)
2. in: jev.ClassifyIntent("Como eu inicializo o ambiente?") -> IntentQuickstart (confiança >= 0.8)
3. in: jev.ClassifyIntent("O que quebra se alterar billing?") -> IntentImpact (confiança >= 0.8)
4. in: jev.ClassifyDriftSeverity("spec forbids db import", "added import db/sql") -> SeverityBreaking
## Dívidas conscientes / Fora
- Chamadas HTTP remotas pesadas (foco em JEV local-first, process runners e zero-token floor)
