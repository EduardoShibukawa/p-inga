---
mode: mvp
goal: "O gira.yaml do p-inga carrega o tour e os workflows que saíram do código do gira (seção docsite:)"
done_when: "grep -q '^docsite:' gira.yaml && gira docs --output /tmp/pinga-docsite >/dev/null && grep -q 'pinga-stable' /tmp/pinga-docsite/index.html"
touch:
  - gira.yaml
  - tasks/T80/PLAN.md
tests_frozen: []
---

## Contexto
- Formato da seção `docsite:` (title, tour[], workflows[], pillars[]) em `gira-g/internal/manifest/manifest.go:26-60`.
- Conteúdo original: `git -C gira-g show 9acce17:internal/docsite/tour.go` (linhas 309-370) e `landing.go` (421-422), com `bun .pinga/pinga-stable verify ...`.
- RED: sem `docsite:` no gira.yaml o `done_when` falha na base.
- Não fazer: não mexer em código do p-inga.
