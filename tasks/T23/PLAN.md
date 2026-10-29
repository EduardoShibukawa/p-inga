---
mode: mvp
goal: "Com $GINGA_EVENTS definido o pinga só emite eventos (envelope v1) e não chama o Discord; resolveDiscordConfig fica só no ambiente, sem ~/.hermes nem canal fixo"
done_when: "bun test tests/discord_events.test.ts tests/discord.test.ts"
touch: ["src/discord.ts", "src/cli.ts", "src/events.ts", "tests/discord_events.test.ts", "tests/discord.test.ts"]
tests_frozen: ["tests/discord_events.test.ts", "tests/discord.test.ts"]
---

# T23: pinga deixa de notificar direto (PLAN-0010 TASK-06-pinga-sem-discord)

- `emitNoticeEvent` em `src/events.ts` (kind `blocker`, O_APPEND) é o canal novo do `pinga notify` e do `queue --notify`.
- `tests/discord.test.ts` caso 1 usa HOME falso (replan de 2026-10-28 no log.md do PLAN-0010).
