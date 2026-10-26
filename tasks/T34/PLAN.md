---
mode: padrao
goal: "Isolate external target docsite from Gira-G marketing"
touch:
  - gira.yaml
done_when: /home/shibuka/.local/bin/gira docs --output build && ! grep -q "The 5 Core Pillars of Gira-G" build/index.html && ! grep -q "cmd/gira/main.go" build/tour.html && grep -q "P-Ingá" build/index.html
---
# T34: Generic Docsite Isolation & P-Ingá GitHub Pages Parity

Isolate external target docsite from Gira-G marketing and verify zero leak.

## Context
Running `gira docs` on external repositories leaked Gira-G marketing.

## Invariants Enforced
- External projects render dedicated titles, badges, workflows, and domains.
- Guided tour walks through real project components with zero Gira-G AST paths.
- Search index and navigation adapt dynamically to target project assets.
