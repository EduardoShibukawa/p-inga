---
mode: padrao
cobre: [W6, W7, W8, W9, W10, W11, W12]
goal: "Painel acessível e endurecido: render sem injeção, CORS local, zero caminho fixo de máquina e estado ao vivo confiável."
touch:
  - web/index.html
  - web/server.ts
cria: [tests/ux_t52_hardening.test.ts]
done_when: "bun test tests/ux_t52_hardening.test.ts"
---

# T52 — Render seguro e acessível

- W6: um `<h1>`, landmarks `<main>`/`<nav>`, abas `role=tab`+`aria-selected`, `aria-live=polite` no resultado.
- W7: log e mensagens via `textContent`; teste com `<img src=x onerror=...>` prova que nada executa.
- W8: CORS só para a origem do painel; Origin estranho recebe 403 em POST; sem `Allow-Origin: *`.
- W9: `GIRA_MAP`/`OPENCODE_BIN`/`LEDGER_PATH` por env, default relativo e aviso quando ausente.
- W10: heartbeat SSE a cada 5s, "última atualização há Ns" no badge e reconexão com backoff exponencial (teto 30s).
- W11: `alert`/`confirm` trocados por toast + histórico; teste garante zero ocorrências no arquivo.
- W12: contador de leituras persistido (`.pinga/readings.json`), sobrevive a restart.
- Prova: asserções sobre o HTML servido (parse sem dependência nova) + HTTP real contra o servidor.
