---
mode: padrao
goal: "Desacoplar tests/discord.test.ts (T26) e tests/ux_t52_hardening.test.ts (W12) do HOME real, usando HOME falso via tests/helpers/home.ts"
touch:
  - src/discord.ts
  - tests/discord.test.ts
  - tests/ux_t52_hardening.test.ts
  - tasks/T74/PLAN.md
tests_frozen: []
done_when: "HOME=/tmp/pinga-task03-red bun test tests/discord.test.ts tests/ux_t52_hardening.test.ts"
---
# T74: HOME falso para T26 e W12 (PLAN-0018)
