# RED T20 — Modo Maestro com Hermes e Meta-Aprendizado (`tests/maestro.test.ts`)

## 1. Escopo e Contrato

Implementa o **Plano A · Maestro-cêntrico** com o Hermes perfil `g-inga`, envelopes com teto de 4096 bytes e meta-aprendizado de orquestração sobre o histórico empírico do ledger (`.pinga/ledger.db`).

### 1.1 Invariantes Principais
1. **Teto de Envelope (`MAX_ENVELOPE_BYTES = 4096`)**: nenhum envelope serializado enviado ao Hermes pode exceder 4096 bytes UTF-8. Trunca deterministicamente resumos se necessário.
2. **Meta-Aprendizado (Lei 1 / FTPR)**: calcula First-Time Pass Rate e mediana de tokens por tarefa verificada para cada modelo do ledger. Modelos com menos de 2 tarefas são rotulados `unranked`.
3. **Turno Efêmero do Hermes**: chamadas ao Hermes utilizam `-z --usage-file <tmp>` para manter a sessão fechada por turno e capturar telemetria estruturada.
4. **Recomendação Auditável**: `recommendOrchestration` escolhe entre topologia `"motor"` (tarefas diretas/leves) e `"maestro"` (tarefas completas/complexas) justificando com métricas reais do placar.

## 2. API Esperada

```ts
// src/maestro.ts
export const MAX_ENVELOPE_BYTES = 4096;

export type TaskRequestEnvelope = {
  v: 1;
  type: "task.request";
  id: string;
  repo: string;
  base_ref: string | null;
  mode: "mvp" | "padrao" | "completo";
  goal: string;
  contract_ref: { path: string; sha256: string };
  budget: { tokens?: number; minutes?: number; attempts?: number };
  origin: "operator" | "hermes" | "cron";
  reply_to: string;
};

export type MaestroReceiptEnvelope = {
  v: 1;
  type: "maestro.receipt";
  id: string;
  status: "pass" | "fail" | "blocked" | "not run";
  reason_code: string | null;
  mode_effective: string;
  attempts: number;
  tokens: { in: number | null; out: number | null; source: string | null };
  recommendation?: { next_worker?: string; topology: "motor" | "maestro"; reason: string };
  summary: string;
};

export type WorkerStats = {
  model: string;
  family: string;
  total_tasks: number;
  ftpr: number;
  median_tokens_per_verified: number | null;
  breaker_trips: number;
  holdout_failures: number;
  status: "ranked" | "unranked";
};

export type Scoreboard = {
  updated_at: string;
  workers: WorkerStats[];
};

export function truncateEnvelopeString(s: string, maxBytes: number): string;

export function createTaskRequest(planPath: string, opts?: { origin?: "operator" | "hermes" | "cron"; replyTo?: string }): TaskRequestEnvelope;

export function buildMaestroEnvelope(receipt: unknown, scoreboard?: Scoreboard): MaestroReceiptEnvelope;

export function computeWorkerScoreboard(ledgerPath?: string, dbPath?: string): Promise<Scoreboard>;

export function recommendOrchestration(planPath: string, scoreboard: Scoreboard): {
  recommended_worker: string | null;
  topology: "motor" | "maestro";
  reason: string;
};

export function formatMaestroDigest(scoreboard: Scoreboard, recentReceipts: unknown[]): string;

export function runHermesMaestroTurn(prompt: string, opts?: { hermesBin?: string; timeoutMs?: number }): Promise<{
  exitCode: number;
  stdout: string;
  tokens_in: number | null;
  tokens_out: number | null;
}>;
```

## 3. Casos de Teste (`tests/maestro.test.ts`)

1. `createTaskRequest` lê `PLAN.md` e monta envelope `task.request` válido com hashes corretos.
2. `buildMaestroEnvelope` trunca resumo longo garantindo que o JSON UTF-8 resultante tenha `<= 4096` bytes.
3. `buildMaestroEnvelope` serializa recibos de status `pass`, `fail` e `blocked`.
4. `computeWorkerScoreboard` com ledger sintético calcula corretamente `ftpr` e `median_tokens_per_verified`.
5. `computeWorkerScoreboard` rotula modelo com < 2 tarefas como `unranked`.
6. `computeWorkerScoreboard` conta disparos de disjuntor e falhas de holdout por modelo.
7. `recommendOrchestration` recomenda topologia `"motor"` para tarefas simples/mvp.
8. `recommendOrchestration` recomenda topologia `"maestro"` para tarefas em modo `completo`.
9. `recommendOrchestration` escolhe o modelo com melhor equilíbrio de FTPR e menor consumo mediano de tokens.
10. `formatMaestroDigest` gera texto conciso em markdown para notificação executiva.
11. `runHermesMaestroTurn` executa stub de Hermes com `-z --usage-file` e extrai tokens com precisão.
12. CLI `pinga maestro scoreboard --json` emite placar estruturado com exit 0.
13. CLI `pinga maestro recommend <PLAN.md> --json` emite recomendação justificada com exit 0.
14. CLI `pinga maestro envelope <PLAN.md>` gera envelope de até 4096 bytes com exit 0.
15. CLI `pinga maestro digest` formata resumo do ledger atual.
