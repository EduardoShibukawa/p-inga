---
mode: mvp
goal: "prove-red trata RED por erro de import/compilação como inconclusivo (not run), não como pass"
touch:
  - src/prove.ts
done_when: "bun test tests/prove-strict.test.ts"
tests_frozen: ["tests/prove-strict.test.ts"]
---
# T43: RED forte no prove-red

done_when que falha no base só porque um módulo não existe (bun `Cannot find
module`, Go `undefined:`/`no required module provides package`, TS `Cannot
find name`) não prova comportamento. classifyBaseRun passa a olhar a saída:
padrão de resolução sem marcador de asserção -> inconclusive (reason infra,
summary "RED por erro de import/compilação, não por asserção").
