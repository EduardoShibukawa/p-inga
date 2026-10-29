---
mode: mvp
goal: "O guard de payload do hook sem config segue o provider por PATH: sem gira no PATH a dica não cita o gira (A6)"
done_when: "bun test tests/hooks_guard_path.test.ts tests/hooks_provider.test.ts tests/hooks.test.ts"
touch:
  - src/hooks.ts
  - tests/hooks_guard_path.test.ts
  - tasks/T81/PLAN.md
tests_frozen:
  - tests/hooks_guard_path.test.ts
---

## Contexto
- Achado do judge do PLAN-0009 (AC-A6 / TASK-06): `guardReasonFor` (src/hooks.ts) só consulta a config explícita; deve usar `contextProvider(base)` (config → PATH → rg).
- O T77 (`tests/hooks_provider.test.ts`, congelado) segue válido: o caso 8 roda com gira no PATH.
- Não fazer: não mudar mensagens exportadas nem `contextProvider`.
