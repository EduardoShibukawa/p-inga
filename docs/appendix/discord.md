---
title: Apêndice — Notificação Discord
section: Appendix
order: 1
---

# Apêndice: notificação externa (fora de escopo)

Este apêndice preserva o desenho histórico da invariante **I20** e do nó
`DISCORD` do diagrama de arquitetura, ambos **fora de escopo** no caminho ativo
de verificação.

## Por que saiu do caminho ativo

O recibo selado no ledger é a fonte de verdade. Enviar embeds para um canal
externo durante a verificação acoplava o gate a rede, credenciais e latência de
terceiros — três coisas que quebram reprodutibilidade offline (I19).

## O que sobrou no core

A invariante I20 hoje se chama **Observabilidade Isolada**: qualquer notificação
externa é opcional, best-effort e nunca bloqueia nem altera a verificação.

## Nó histórico do diagrama

```text
LEDGER["Append Block to ledger.db"] --> DISCORD["Notify Discord (#hermes / dev)"]
```

O nó `DISCORD` foi removido de `docs/intro.md`; o fluxo canônico termina no
ledger.

## Código

O módulo `src/discord.ts` e seu teste continuam no repositório como utilitário
opcional, sem participação no gate. Nenhum comando de verificação o invoca.
