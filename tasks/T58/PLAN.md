---
mode: padrao
goal: "vigia da fila não forja transição em massa: o snapshot guarda procedência (versão + ledger) e, quando a procedência muda entre runs, o run recria o baseline em silêncio (zero transições) com 'baseline' no digest; transição real do mesmo ledger continua anunciada"
touch:
  - src/queue.ts
  - scripts/pinga-queue-watch.sh
done_when: "bun test tests/queue_snapshot_provenance.test.ts"
tests_frozen: ["tests/queue_snapshot_provenance.test.ts"]
---
# T58: snapshot da fila sem procedência forja transição em massa

Em 2026-10-27 11:04:54 o vigia anunciou **54 transições falsas** (`T12: open ->
done` … `T57: open -> done`) sem nada mudar: a fila já estava `done 39`. Causa:
`.pinga/queue-snapshot.json` guarda só `{task: estado}`, sem procedência. Um run
que resolveu para ledger vazio gravou `open` para toda task; o run seguinte, no
ledger correto, publicou a fila inteira como recém-concluída.

Correção: snapshot com procedência (`v: 2` + `ledger` absoluto) numa chave que
`readSnapshot` ignora como estado; procedência diferente ⇒ zero transições,
baseline reescrito e digest com `baseline`. O script do vigia só propaga.

Teste congela: snapshot de outro ledger não vira transição; `open -> done` do
mesmo ledger continua anunciado.
