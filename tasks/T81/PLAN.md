---
mode: mvp
goal: "pinga learn propose e pinga learn promote avisam no stderr que as lições migraram para o ginga, sem mudar a saída nem o exit code"
done_when: "bun test tests/learn_migrado.test.ts"
touch:
  - src/cli.ts
  - src/lessons_migrado.ts
  - tests/learn_migrado.test.ts
  - tasks/T81/PLAN.md
tests_frozen:
  - tests/learn_migrado.test.ts
---

## Contexto
- Os ramos `propose` e `promote` de `src/cli.ts` escrevem o aviso no stderr.
- A constante compartilhada vive em `src/lessons_migrado.ts`.
- O teste preserva stdout e exit code; não alterar `src/lessons.ts`.
