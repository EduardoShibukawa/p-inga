---
mode: padrao
goal: "Discord Notifications & Remote Task Observability: src/discord.ts e cli notify."
done_when: "bun test tests/discord.test.ts"
touch: ["src/discord.ts", "src/cli.ts", "src/verify.ts"]
---
## Passos
- [x] GREEN: src/discord.ts, tests/discord.test.ts, CLI notify e verify webhook
## Exemplos (gerados antes do código)
1. in: resolveDiscordConfig() -> token & channel resolvidos
2. in: formatReceiptDiscordEmbed(receipt) -> embed com status color e fields
3. in: sendDiscordMessage() -> envio para API REST v10 do Discord
## Dívidas conscientes / Fora
- gateway polling bidirecional para comandos recebidos via Discord
