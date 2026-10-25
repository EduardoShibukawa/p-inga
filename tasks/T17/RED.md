# RED T17 — Detector de Correção do Usuário (`tests/user-correction.test.ts`)

## 1. Escopo e Contrato

Resolve o problema da baixa precisão (~1 em 10) do detector ingênuo de correção do usuário (linha 1037 do anexo `#metodos`).

### 1.1 Regras de Distinção
1. **Filtro de Subagente/Sistema**:
   - `is_sidechain === 1` ou `is_subagent === true` → descartado (não é humano externo).
   - Prompts com mais de 400 caracteres ou iniciando com tags estruturadas (`<TASK>`, `<SYSTEM_MESSAGE>`, `[Message]`) → descartados.
   - Mensagens contendo apenas resultados de ferramentas (`tool_result`) → descartadas.
2. **Marcadores de Correção Humana**:
   - Texto curto (≤ 400 caracteres) contendo marcadores de reversão/correção explícitos em português ou inglês:
     - PT: `\b(não|nao|errado|pare|reverte|desfaça|desfaca|volta|corrija|em vez disso)\b` (case-insensitive).
     - EN: `\b(no|wrong|stop|revert|undo|don't|dont|instead|incorrect)\b` (case-insensitive).
3. **Correlação Temporal**:
   - O turno humano com marcador deve ocorrer imediatamente após uma chamada de ferramenta que falhou (`exit !== 0` ou `is_error === true`), OU
   - O turno deve ser seguido por nova edição ou tentativa no mesmo arquivo/alvo.
4. **6º Detector em `src/detect.ts`**:
   - Integrado na lista `DETECTORS` de `detectAll` com id `"user_correction"` e pattern `"correção humana do usuário após atrito"`.

## 2. API Esperada

```ts
// src/detect.ts
export const CORRECTION_MARKERS_PT_EN: RegExp;

export function isHumanCorrectionPrompt(turn: {
  text: string;
  is_sidechain?: boolean;
  preceding_tool_failed?: boolean;
}): boolean;

export function detectUserCorrection(db: Database): LessonCandidate[];

// src/learn.ts
export function ingestUserTurns(db: Database, sessionId: string, turns: unknown[]): number;
```

## 3. Casos de Teste (`tests/user-correction.test.ts`)

1. `isHumanCorrectionPrompt` retorna `true` para frases curtas com marcadores após falha: `"não, reverte isso"`, `"wrong file, don't edit that"`, `"pare, isso está errado"`.
2. `isHumanCorrectionPrompt` retorna `false` para turnos de aprovação ou continuação: `"ok, prossiga"`, `"ficou muito bom"`, `"continue"`.
3. `isHumanCorrectionPrompt` retorna `false` para prompts longos (> 400 chars) mesmo contendo a palavra "não".
4. `isHumanCorrectionPrompt` retorna `false` quando `is_sidechain === true` (chamadas entre agentes).
5. `isHumanCorrectionPrompt` retorna `false` para mensagens de sistema ou que iniciam com `<TASK>`.
6. Tabela `user_turns` em `learn.db` armazena turnos rotulados (`is_human`, `has_correction_marker`, `preceding_tool_failed`).
7. `detectUserCorrection` consulta `learn.db` e gera `LessonCandidate` válidos contendo `session_id`, `excerpt` redigido ≤ 300 chars e métrica clara.
8. `detectAll` executa os 6 detectores determinísticos (`rework`, `unverified`, `breaker`, `overfit`, `guards`, `user_correction`).
9. Precisão sintética: em dataset de benchmark com 20 casos positivos e 20 negativos, o detector atinge precisão ≥ 90%.
