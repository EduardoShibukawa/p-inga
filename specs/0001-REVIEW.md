# REVIEW — SPEC 0001 e Planos T00–T03

Revisão técnica pré-implementação (fase 1), ordenada do item mais grave ao menos grave.

---

### 1. `p-inga/tasks/T03/RED.md:29` e `p-inga/tasks/T03/RED.md:39`
- **O problema:** Para timeout (`done_when: "sleep 5"` com `PINGA_TIMEOUT_MS=200`, caso 5), a tabela fixa `status: "blocked"` e `reason_code: "budget"`, mas não define se `evidence[0].exit` deve ser `null` (já que o processo foi morto por sinal e `Bun.spawnSync` retorna `exitCode: null, exitedDueToTimeout: true`, enquanto `Bun.spawn` assíncrono retorna `exitCode: 143`), nem define o formato de `summary` quando não há `exit` numérico ou quando ocorre timeout.
- **Correção proposta:** Explicitar em `T03/RED.md:29,39` que em caso de timeout `evidence[0].exit` é `null` e `summary` segue o mesmo template (`${task} ${status}: done_when exit ${exit} em ${segundos}s`, resultando em `exit null`).
- **Gravidade:** `bloqueia`

---

### 2. `p-inga/tasks/T03/RED.md:38` e `p-inga/tasks/T01/RED.md:30`
- **O problema:** `T01/RED.md:30` exige `author: { model: string | null, family: string | null }`, mas `T03/RED.md:38` especifica apenas `author.model = PINGA_AUTHOR_MODEL ?? null`, omitindo de onde vem `author.family` (se de `PINGA_AUTHOR_FAMILY ?? null`, se inferido de `model`, ou se sempre `null` até a T08).
- **Correção proposta:** Especificar em `T03/RED.md:38` que `author.family = process.env.PINGA_AUTHOR_FAMILY ?? null` (ou `null` quando `PINGA_AUTHOR_MODEL` não estiver definido).
- **Gravidade:** `bloqueia`

---

### 3. `p-inga/tasks/T01/RED.md:23-24` e `p-inga/tasks/T01/RED.md:52-55`
- **O problema:** Os casos 3 e 4 testam `status: "pass"` (`reason_code` deve ser `null`) e `status: "fail"` (`reason_code` deve estar em `REASON_CODES`), mas a regra para `status: "blocked"` e `status: "not run"` não está explícita no texto: na T03, `status: "blocked"` usa `reason_code: "budget"` ou `"plan_invalid"`. Se o executor exigir `reason_code !== null` apenas para `"fail"`, ou permitir `null` em `"blocked"`, o contrato fica divergente.
- **Correção proposta:** Explicitar em `T01/RED.md:24` que `reason_code` é obrigatoriamente `null` quando `status === "pass"` e obrigatoriamente um elemento de `REASON_CODES` (não-nulo) quando `status !== "pass"`.
- **Gravidade:** `bloqueia`

---

### 4. `p-inga/tasks/T01/RED.md:35-41`
- **O problema:** A seção **Opcionais** diz que `flow`, `mode_effective` e `next_action` *"são conhecidos, e validados se presentes"*, mas não define seus tipos (`string`? enum?). Além disso, `verified_by` (linha 31) e `question` (linha 41) são objetos aninhados e o caso 5 exige rejeitar campos desconhecidos em sub-objetos (exemplificando `tokens`), deixando ambíguo se objetos internos (`author`, `verified_by`, `evidence[]`, `artifact_ref`, `breaker`, `question`) também rejeitam chaves extras.
- **Correção proposta:** Definir em `T01/RED.md:36-41` que `flow`, `mode_effective` e `next_action` são `string` (não vazias se presentes), e que todos os sub-objetos tipados (`tokens`, `author`, `verified_by`, `evidence[i]`, `artifact_ref`, `breaker`, `question`) rejeitam chaves desconhecidas.
- **Gravidade:** `bloqueia`

---

### 5. `p-inga/tasks/T03/RED.md:2` e `p-inga/tasks/T03/PLAN.md:5`
- **O problema:** `T03/RED.md` define o comportamento de `parsePlan` (`src/plan.ts`) e do CLI `verify`, mas não declara as assinaturas exportadas de `src/plan.ts` e `src/verify.ts` (como `T01/RED.md` e `T02/RED.md` fazem). Se `tests/verify.test.ts` importar `parsePlan` diretamente ou se o executor der outro nome/formato ao retorno de `src/verify.ts`, o RED e o GREEN podem desencontrar.
- **Correção proposta:** Adicionar em `T03/RED.md` o bloco `## API esperada` com `export function parsePlan(text: string): { ok: true; plan: Plan } | { ok: false; errors: string[] }` em `src/plan.ts` e especificar se os casos 1–8 testam via CLI (`bin/pinga.ts verify`) + `parsePlan` unitário.
- **Gravidade:** `bloqueia`

---

### 6. `p-inga/tasks/T02/RED.md:7`
- **O problema:** `canonicalJson(x: unknown): string` não define como tratar propriedades com valor `undefined` em objetos (em `JSON.stringify({ a: 1, b: undefined })`, a chave `b` é omitida; se um serializador manual iterar `Object.keys(x)` sem filtrar `v !== undefined`, produzirá `"b":undefined`, que é JSON inválido). Em `Receipt`, campos opcionais ausentes podem existir no objeto JS com valor `undefined`.
- **Correção proposta:** Explicitar em `T02/RED.md:7` que chaves cujo valor seja `undefined` são omitidas na serialização (mesma semântica do `JSON.stringify`).
- **Gravidade:** `melhora`

---

### 7. `p-inga/tasks/T03/RED.md:8`
- **O problema:** "no máximo 25 linhas" em `parsePlan(text)` é ambíguo quanto ao `\n` final (um arquivo de 25 linhas terminado por `\n` tem `text.split("\n").length === 26`). `T00/PLAN.md`, `T02/PLAN.md` e `T03/PLAN.md` têm 21 linhas cada; se um plano tiver 25 linhas com trailing newline e o executor usar `text.split("\n").length > 25` sem remover a última linha vazia pós-`\n`, planos de 25 linhas falharão no lint.
- **Correção proposta:** Especificar em `T03/RED.md:8` que a contagem de linhas ignora uma única quebra de linha final (`text.replace(/\r?\n$/, "").split(/\r?\n/).length <= 25`).
- **Gravidade:** `melhora`

---

### 8. `p-inga/tasks/T03/RED.md:43` e `p-inga/tasks/T00/RED.md:20`
- **O problema:** `T03/RED.md:43` diz que `scripts/stable.ts` grava `.pinga/pinga-stable` e `.pinga/stable.json`, enquanto o `.gitignore` testado na `T00/RED.md:20` testa `.pinga/pinga-stable` e a seção 3 da T03 grava `.pinga/ledger.db`. Se o executor na T00 colocar `.pinga/pinga-stable` literal no `.gitignore` em vez do diretório `.pinga/`, `.pinga/stable.json` deixará a árvore suja após `mise run stable`.
- **Correção proposta:** Em `T00/RED.md:20`, mencionar `.pinga/` (testando `.pinga/pinga-stable` e `.pinga/stable.json`) para garantir que todo o diretório `.pinga/` seja ignorado.
- **Gravidade:** `melhora`

---

### 9. `p-inga/specs/0001-p-inga-v0.1.md:19-20` e `p-inga/specs/0001-p-inga-v0.1.md:64-71`
- **O problema:** A SPEC (`D5`, `D6` e template de `EVAL.md` na `§6`) ainda reflete o desenho sem separação Planejador/Executor (não inclui as linhas `executor: ... · planejador: ...`, `escopo: ...` e `parecer: ...` exigidas pelo orquestrador atual na seção 2.c).
- **Correção proposta:** Atualizar `specs/0001-p-inga-v0.1.md:19-20,64-71` para alinhar `D5`/`D6` (Planejador Gemini 4 Argon + Executor escolhido por task) e o template de `EVAL.md` com o formato completo do orquestrador.
- **Gravidade:** `melhora`

---

## Verificações de ambiente realizadas (Bun 1.4.4 + git)

Testadas em diretório temporário (`mktemp -d`) antes de redigir esta revisão:

```text
$ mise ls bun hk
bun   1.4.4    ~/.config/mise/config.toml  latest
hk    1.24.0

# Bun.YAML.parse + bun:sqlite triggers BEFORE UPDATE RAISE(ABORT, 'append-only')
YAML: function {
  mode: "padrao",
  budget: {
    tokens: 150000,
    minutes: 30,
  },
}
Trigger caught: append-only

# git check-ignore -q --no-index + bun build --compile
raw/a.jsonl -> 0
state/learn.db -> 0
x.db -> 0
runs/T00/1/out.txt -> 0
.pinga/pinga-stable -> 0
node_modules/x -> 0
testdata/fixtures/a.jsonl -> 1
specs/0001-p-inga-v0.1.md -> 1
tasks/T00/PLAN.md -> 1
tasks/T00/EVAL.md -> 1
ok

# Bun.spawnSync vs Bun.spawn com timeout: 200 em "sh -c 'sleep 5'"
spawnSync ms: 203 exitCode: null signalCode: SIGTERM exitedDueToTimeout: true
spawn async: exitCode: 143 signalCode: SIGTERM killed: true
```
