# SPEC 0005 — P-Ingá v0.3 Plano A (Modo Maestro, Envelopes & Meta-Aprendizado de Orquestração)

- status: draft (aprovado para implementação)
- data: 2026-10-25
- herda: `specs/0001-p-inga-v0.1.md`, `specs/0002-p-inga-v0.1-rodada-3.md`, `specs/0003-p-inga-v0.1-rodada-4.md`, `specs/0004-p-inga-v0.2-metodos.md`.
- justificativa: parecer https://claude.ai/artifact/VLi8Q6XHTU9h5rFgHA3Pft (`#plano-a`, `#envelopes` §5.4, `#recomendacao` v0.3) e `../P-INGA-INSTALL-E-APRENDIZADO.md`.

## 1. Contexto e Objetivos

O parecer de arquitetura recomendou iniciar pelo **Plano B (Motor no centro)** para construir o ledger de recibos e as garantias das Três Leis. As versões v0.1 e v0.2 entregaram com sucesso essa fundação através das tarefas T00 a T19 (ledger encadeado, verificação de guardas, disjuntor, tokens de host, instalador com HOME-sombra, ingestão multi-harness e auditoria).

A versão v0.3 introduz o **Plano A (Modo Maestro com Hermes perfil `g-inga`)**, viabilizando:
1. **Coexistência Dual**: Capacidade de rodar o P-Ingá no Modo Motor direto (interativo/operador) ou no Modo Maestro (Hermes despachando e supervisionando).
2. **Eliminação do Inchaço de Contexto**: Envelopes estritos `task.request` e `task.receipt` com teto de 4096 bytes (`MAX_ENVELOPE_BYTES = 4096`), contendo apenas referências opacas de artefatos (`artifact_ref`), eliminando o inchaço de 10x–35x identificado nas sessões longas.
3. **Meta-Aprendizado de Orquestração**: Placar dinâmico de operários baseado no histórico de recibos (`ledger.db` e `learn.db`), calculando First-Time Pass Rate (FTPR), mediana de tokens por tarefa verificada e falhas de disjuntor/holdout para recomendar o melhor modelo e topologia de despacho.
4. **Sessões Efêmeras do Hermes**: Disparo do Maestro em turnos curtos (`-z --usage-file`), fechando a sessão a cada despacho e gerando digests executivos.

## 2. Decisões Fixadas (D27 a D32)

| # | Decisão | Valor |
|---|---|---|
| D27 | Coexistência Motor / Maestro | O P-Ingá Core suporta despacho manual direto pelo operador (Plano B) ou via interface Maestro (Plano A) sob o comando `pinga maestro` |
| D28 | Teto Estrito de Envelope | `MAX_ENVELOPE_BYTES = 4096`. O envelope `task.request` e o resumo `task.receipt` enviados ao Hermes nunca excedem 4 KB em UTF-8. Logs e diffs extensos permanecem confinados em arquivos de artefato locais referenciados por SHA-256 |
| D29 | Placar Adaptativo de Operários (`computeWorkerScoreboard`) | Agrega por modelo/família e por modo (`mvp`, `padrao`, `completo`): FTPR (taxa de pass na tentativa 1), mediana de tokens por tarefa verificada, disparos de disjuntor e quedas em holdout |
| D30 | Recomendação de Orquestração (`recommendOrchestration`) | Analisa o contrato da tarefa (`PLAN.md`) frente ao placar empírico e recomenda o operário ótimo e a topologia (`"motor"` para tarefas simples/mvp ou `"maestro"` para runs autônomos complexos) com justificativa fundamentada |
| D31 | Turno Efêmero do Hermes (`runHermesMaestroTurn`) | Hermes executado com `-z --usage-file <tmp>` para manter a sessão fechada por turno, prevenindo acúmulo de contexto residual |
| D32 | Digest de Orquestração (`formatMaestroDigest`) | Formatação sintética em markdown/texto de tarefas concluídas, falhas bloqueadas e consumo de tokens para notificação ao operador |

## 3. Invariantes (I26 a I30)

- **I26 (Teto Rígido de Envelope)**: `buildMaestroEnvelope` trunca deterministicamente resumos e descrições se o payload serializado exceder 4096 bytes, assegurando conformidade estrita com o limite de contexto do Maestro.
- **I27 (Honestidade no Placar)**: Modelos com menos de 2 tarefas verificadas no ledger recebem status `unranked`, exigindo amostragem mínima antes de liderarem recomendações de custo.
- **I28 (Precedência da Lei 1)**: Recomendações de operário priorizam menor mediana de tokens por tarefa verificada entre modelos com FTPR satisfatório (≥ 70%).
- **I29 (Hermes Isolado e Efêmero)**: A execução do Hermes nunca roda como daemon persistente desgovernado; cada despacho é um subprocesso delimitado com timeout e captura de tokens.
- **I30 (Modo Padrao Preservado)**: A implementação de T20 não toca arquivos de migração, auth ou lockfiles, mantendo `touchesCritical === null`.

## 4. Contratos Compartilhados

### 4.1 Schemas de Envelope Maestro (`src/maestro.ts`)

```ts
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
```

### 4.2 Scoreboard de Operários

```ts
export type WorkerStats = {
  model: string;
  family: string;
  total_tasks: number;
  ftpr: number; // 0.0 a 1.0
  median_tokens_per_verified: number | null;
  breaker_trips: number;
  holdout_failures: number;
  status: "ranked" | "unranked";
};

export type Scoreboard = {
  updated_at: string;
  workers: WorkerStats[];
};
```

## 5. Escopo da Entrega

| Task | Entrega | Contrato |
|---|---|---|
| **T20** | Plano A: Modo Maestro, Envelopes <= 4KB e Meta-Aprendizado | `tasks/T20-maestro-hermes/` |

## 6. Critérios de Aceite

| AC | Critério | Verificação |
|---|---|---|
| AC-20 | Maestro e Scoreboard conforme `tasks/T20-maestro-hermes/RED.md` | `bun test tests/maestro.test.ts` |
| AC-ENV | Garantia de teto `<= 4096` bytes mesmo com entradas extensas | teste unitário em `tests/maestro.test.ts` |
| AC-SCORE | Scoreboard agrega FTPR e tokens com dados reais do ledger | teste de integração com `.pinga/ledger.db` |
| AC-CLI | CLI `pinga maestro scoreboard|recommend|envelope|digest` funcional | execução de comandos CLI em testes |
| AC-ALL | Suíte integral de testes verde (≥ 155 testes) | `bun test` |
