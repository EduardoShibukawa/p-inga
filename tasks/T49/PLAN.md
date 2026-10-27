---
mode: padrao
goal: "Inventariar com arquivo:linha as superficies de UX do p-inga (web/index.html+server.ts, src/adapters/tuios.ts, docs/) e emitir specs/draft-0008-ux-unificado-p-inga.md em status draft com achados priorizados e criterios de aceite verificaveis."
done_when: "bun test tests/ux_t49_validate.test.ts"
tests_frozen:
  - tests/ux_t49_validate.test.ts
touch:
  - specs/draft-0008-ux-unificado-p-inga.md
  - tasks/T49/PLAN.md
  - tasks/T49/evidence/inventory.md
---
# T49: Analise UX p-inga (web / TUIOS / DOCS)

## Escopo
- web: `web/index.html` + `web/server.ts` (dashboard :4242, SSE, acoes)
- TUIOS: `src/adapters/tuios.ts` e superficie de terminal do operador
- DOCS: `docs/**` e o docsite gerado por `gira docs` para o p-inga

## Decisoes do operador (2026-10-26)
- Discord FICA FORA deste escopo (prototipo untracked, plataforma desabilitada)
- A spec mora no proprio repo tocado (p-inga/specs), uma spec por repo

## Saida
Spec em draft com achados `arquivo:linha`, severidade, criterio de aceite
por achado e tasks de execucao proposta. Sem prosa sem ancora; sem commit.
