# RED T19 — Auditoria de `--no-verify` e Precisão de Lições (`tests/audit.test.ts`)

## 1. Escopo e Contrato

Resolve as linhas 1038 (`--no-verify` em commits reais) e 1051 (Precisão das lições — amostra de 30) do anexo `#metodos`.

### 1.1 Auditoria de `--no-verify`
1. **Varredura em `learn.db`**:
   - Localiza ocorrências da flag `--no-verify` em tool calls de `Bash`/`shell` nos transcripts ingeridos.
2. **Cruzamento com Histórico Git (`--repo <git-dir>`)**:
   - Cruza os hashes de commit e mensagens do histórico git (`git log`, `git reflog`) com as invocações detectadas.
   - Separa menções em prosa (e.g. "não use --no-verify") de execuções efetivas que criaram commits com bypass de hooks.
   - Emite métrica `{ tool_calls_flagged: number, git_commits_bypassed: number, clean_ratio: number }`.

### 1.2 Avaliador de Precisão de Lições
1. **Amostragem Determinística**:
   - Seleciona uma amostra estratificada de até `N` (default 30) lições propostas em `learn.db`, ordenadas pelo hash SHA-256 do id para reprodutibilidade.
2. **Critérios de Utilidade**:
   - Uma lição é considerada `useful` se:
     1. Possui regra acionável (não apenas observação passiva);
     2. Possui evidência ancorada em ≥ 2 sessões ou ≥ 3 eventos;
     3. Possui repositório ou alvo concreto definido.
3. **Gate de Precisão**:
   - Calcula `precision_ratio = useful_count / sample_size`.
   - `passes_gate === true` se e somente se `precision_ratio >= 0.70` (threshold configurável).

## 2. API Esperada

```ts
// src/audit.ts
export type NoVerifyAuditResult = {
  tool_calls_flagged: number;
  git_commits_bypassed: number;
  clean_ratio: number;
};

export type LessonPrecisionResult = {
  sample_size: number;
  useful_count: number;
  precision_ratio: number;
  passes_gate: boolean;
  gate_threshold: number;
  details: Array<{
    id: string;
    pattern: string;
    is_useful: boolean;
    reason: string;
  }>;
};

export function computeAuditGate(input: {
  sample_size: number;
  useful_count: number;
  threshold?: number;
}): boolean;

export function auditNoVerify(db: Database, repoPath?: string): Promise<NoVerifyAuditResult>;

export function evaluateLessonsPrecision(
  db: Database,
  opts?: { sampleSize?: number; threshold?: number },
): LessonPrecisionResult;
```

## 3. Casos de Teste (`tests/audit.test.ts`)

1. `auditNoVerify` detecta chamadas de shell com `git commit --no-verify` em dados de transcript.
2. `auditNoVerify` ignora menções de texto que não são chamadas de execução de comando.
3. `auditNoVerify` cruza com commits reais do repositório git e calcula `clean_ratio` com precisão.
4. `evaluateLessonsPrecision` amostra até 30 lições de forma determinística por SHA-256.
5. `evaluateLessonsPrecision` aprova lição com evidência multi-sessão e rejeita lição genérica ou sem regra.
6. `evaluateLessonsPrecision` retorna `passes_gate: true` para taxa de precisão ≥ 0.70 e `false` se < 0.70.
7. Subcomando CLI `pinga learn audit --db <path> --json` emite saída estruturada completa.
8. Subcomando CLI `pinga learn audit --repo <dir>` executa auditoria git sem erro de repositório sujo.
9. Amostra vazia (0 lições) retorna `passes_gate: false` sem lançar divisão por zero.
10. Relatório detalha razões individuais para cada lição avaliada na amostra.
