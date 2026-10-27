---
mode: padrao
goal: "Gate adversarial do draft-0008: verificar cada achado W/T/D contra o codigo, corrigir a spec e aprova-la (Status: approved), distribuindo os achados sobreviventes em tasks de execucao com touch existente."
done_when: "bun test tests/ux_t36_gate.test.ts"
tests_frozen:
  - tests/ux_t36_gate.test.ts
touch:
  - specs/draft-0008-ux-unificado-p-inga.md
  - tasks/T36/evidence/gate.md
  - tasks/T37/PLAN.md
  - tasks/T38/PLAN.md
  - tasks/T39/PLAN.md
---
# T36: Gate adversarial da spec 0008 (UX p-inga)
## Regras
- Veredito por achado: `keep`, `drop`, `merge` ou `reframe`; abrir cada ancora no codigo.
- Ancora que nao sustenta a claim = `drop`/`reframe` com motivo. Aceite sem teste = `reframe`.
- Nenhum achado novo entra; nenhum some sem linha em `tasks/T36/evidence/gate.md`.
- Discord fora de escopo: a spec so remove a promessa da doc, nao constroi mensageria.
## Saida
`gate.md` com tabela ID x veredito x motivo, spec `Status: approved`, 3+ tasks `T37..T39` com
`cobre: [IDs]` no frontmatter, cobertura completa e disjunta. Sem commit.
