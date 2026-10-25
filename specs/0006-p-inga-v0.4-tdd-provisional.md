# SPEC 0006 — P-Ingá v0.4 (TDD Provisional & Integração Gira-G)

- status: draft (aprovado para implementação)
- data: 2026-10-25
- herda: `specs/0001-p-inga-v0.1.md`, `specs/0002-p-inga-v0.1-rodada-3.md`, `specs/0003-p-inga-v0.1-rodada-4.md`, `specs/0004-p-inga-v0.2-metodos.md`, `specs/0005-p-inga-v0.3-plano-a-maestro.md`.
- justificativa: Evidência empírica no `llm-bench` (INTENT 0003) — a restrição rígida de testes congelados gerou hiper-vigilância defensiva nos modelos pequenos, forçando o uso de scripts soltos em `run_python`. O P-Ingá deve fornecer um mecanismo formal de TDD provisional que permita ao operário criar testes de hipótese sem violar o Invariante I5.

## 1. Contexto e Objetivos

O P-Ingá impõe a imutabilidade da suíte de aceitação (`tests_frozen`, Invariante I5) para garantir que um agente não altere os testes para mascarar defeitos. Contudo, em tarefas complexas onde os testes de aceitação estão ocultos ou são de nível de integração, o agente necessita do ciclo Red-Green-Refactor (TDD).
Ao proibir genericamente qualquer modificação na pasta `tests/`, os agentes locais entram em paralisia ou dispersão com dezenas de chamadas a interpretadores ad-hoc.

A versão v0.4 resolve esse gargalo introduzindo:
1. **Testes Provisionais (Scratchpad TDD)**: Reconhecimento formal de arquivos de teste criados pelo agente para provar o defeito e guiar a implementação.
2. **Imunidade de Guardas**: Testes provisionais não disparam violação de `tests_frozen_changed` (I5) nem `scope_drift` (I6).
3. **Comando CLI `pinga tdd` / `pinga prove-provisional`**: Execução e verificação de testes provisionais, inclusive com verificação opcional na base.
4. **Integração Gira-G no Doctor e Maestro**: Verificação do mapa de arquitetura e do setup do Gira-G.

## 2. Decisões Fixadas (D33 a D36)

| # | Decisão | Valor |
|---|---|---|
| D33 | Padrão de Teste Provisional | Arquivos em `tests/provisional/`, `tests/scratch/` ou que casem com prefixos `scratch_` / `test_scratch_` / `.scratch.` são identificados por `isProvisionalTest(path)` |
| D34 | Imunidade no Guardião (`evaluateGuards`) | Arquivos identificados como provisionais são automaticamente excluídos da verificação de `tests_frozen` e permitidos contra `scope_drift` |
| D35 | Subcomando CLI `pinga tdd` | Subcomando para executar e validar testes provisionais isolados da suíte oficial |
| D36 | Detecção de Gira-G no Doctor | O `pinga doctor` verifica a presença de `gira` no PATH e a existência de `.gira/macro-map.json` |

## 3. Invariantes (I31 e I32)

- **I31 (Preservação da Aceitação Congelada)**: Testes provisionais nunca substituem os testes congelados; o comando `pinga verify` avalia a suíte completa de `done_when` e rejeita qualquer alteração em arquivos listados em `tests_frozen`.
- **I32 (Classificação Determinística de Provisional)**: A função `isProvisionalTest(path)` é pura, determinística e normaliza caminhos relativos para evitar escapes (`../`).
