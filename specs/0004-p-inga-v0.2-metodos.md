# SPEC 0004 — P-Ingá v0.2 Fechamento de Métodos e Backlog (T16 a T19)

- status: draft (aprovado para implementação)
- data: 2026-10-25
- herda: `specs/0001-p-inga-v0.1.md` (D1–D7, I1–I9), `specs/0002-p-inga-v0.1-rodada-3.md` (D8–D14, I10–I15) e `specs/0003-p-inga-v0.1-rodada-4.md` (D15–D20, I16–I20).
- justificativa: parecer https://claude.ai/artifact/VLi8Q6XHTU9h5rFgHA3Pft (`#metodos` linhas 1033–1038, 1051; `#decisoes` linha 1017 / `#backlog`) e `../P-INGA-INSTALL-E-APRENDIZADO.md`.

## 1. Contexto e Objetivos

Com a conclusão da Rodada 4 (T12 a T15), o P-Ingá v0.1 atingiu 16 tarefas fechadas e 35 recibos no ledger, comprovando a infraestrutura de oráculo determinístico, orquestração segura com HOME-sombra e pipeline de aprendizado inicial.

Esta especificação (Rodada 5) fecha todas as pendências listadas no anexo `#metodos` e itens operacionais do `#backlog` da arquitetura, implementando as tarefas **T16 a T19** para alcançar a meta de **≥ 20 tarefas verificadas no ledger**, marco formal para a transição v0.1 → v0.2:

1. **T16 (Multi-harness ingest)**: Suporte à ingestão de pi JSONL, opencode.db, hermes state.db e Markdown de fricção, com blocklist estrita de credenciais.
2. **T17 (User correction detector)**: Detector determinístico de correção do usuário de alta precisão (resolvendo a precisão de ~1 em 10 do detector ingênuo).
3. **T18 (Pinga adopt)**: Absorção e normalização de plugins/symlinks pré-existentes no HOME (`pi-harness`, `G-Inga`) sem colisão na guarda A2 do manifest.
4. **T19 (Learn audit & lesson precision)**: Auditoria empírica de bypasses `--no-verify` nos tool calls contra o git real, e validação de precisão de amostra de 30 lições.

## 2. Decisões Fixadas (D21 a D26)

| # | Decisão | Valor |
|---|---|---|
| D21 | Ingestão Multi-harness segura | Suporte nativo a 4 novas fontes: (1) `pi` JSONL; (2) `opencode` SQLite (`session_v2` / `session`); (3) `hermes` SQLite (`state.db`); (4) arquivos Markdown (`FRICTION.md`, `OVERNIGHT-REPORT-*.md`). **Blocklist estrita**: caminhos terminados em `auth.json`, `.env`, `.credentials.json` ou contendo `secrets/` são rejeitados antes da abertura. Redação em 3 camadas e canário rodam antes de qualquer INSERT em `learn.db` |
| D22 | Detector de Correção Humana de Alta Precisão | Distingue prompts de subagentes/sistema (`is_sidechain = 1`, prompts longos > 400 chars, templates `<TASK>`) de correções humanas reais curtas (≤ 400 chars, marcadores em PT/EN: `"não"`, `"errado"`, `"pare"`, `"revert"`, `"wrong"`, `"don't"`, `"stop"`, `"instead"`) correlacionadas com falha anterior de ferramenta ou re-edição subsequente |
| D23 | Comando `pinga adopt` | `--dry-run` e `--apply` com `--home <path>`. Localiza entradas legadas em `~/.claude/plugins/local`, `~/.config/opencode/plugins/` e `~/.pi/agent/extensions/`, gera backup com SHA-256 em `.pinga/backups/<ts>/`, remove symlinks quebrados sob `--apply`, e registra posse no `manifest.json` com `adopted: true`, evitando erro exit 11 no `install` |
| D24 | Auditoria Empírica de `--no-verify` e Precisão | `pinga learn audit --db <path> [--repo <git-dir>] [--sample <n>] [--json]`. Cruza menções de `--no-verify` em tool calls com commits/reflog do repositório para isolar bypasses reais de menções em texto. Avalia amostra estratificada de até 30 lições (`passesGate: precisionRatio >= 0.70`) |
| D25 | Holdout Obrigatório e Validação por Exemplos | Cada tarefa T16–T19 inclui contrato de exemplos com pelo menos 6 casos gerando partição determinística (pelo menos 4 visíveis e 2 holdouts ocultos) via `pinga examples` |
| D26 | Modo das Tarefas T16–T19 | `mode: padrao` (nenhum arquivo em `touch` toca caminhos críticos de `CRITICAL_RULES`, mantendo `touchesCritical` nulo) |

## 3. Invariantes (I21 a I25)

- **I21 (Blocklist de Credenciais)**: Nenhuma rotina de ingestão abre arquivos de credenciais conhecidos (`auth.json`, `.env`, `.credentials.json`). Se detectado caminho proibido, a fonte é ignorada com aviso seguro em stderr, sem leitura de bytes.
- **I22 (Anti-ruído em Correções de Usuário)**: Mensagens geradas por subagentes ou templates automáticos não podem ser classificadas como correções humanas. O detector `user_correction` exige texto humano autêntico curto após evento de atrito.
- **I23 (Adoção Atômica)**: `pinga adopt` é idempotente. Sob `--dry-run`, nenhuma escrita ocorre. Sob `--apply`, grava backup byte a byte antes de qualquer mutação de link e atualiza o `manifest.json` atomicamente.
- **I24 (Auditoria Confiável)**: Contagem de `--no-verify` não se baseia em simples contagem de strings; apenas invocações efetivas de commit com a flag bypass confirmadas no histórico git são registradas como violações.
- **I25 (Amostragem Determinística de Lições)**: A auditoria de precisão de lições utiliza ordenação e amostragem reprodutíveis pelo SHA-256 dos registros, gerando justificativas estruturadas para cada lição aprovada ou rejeitada.

## 4. Contratos Compartilhados

### 4.1 Schema de Turnos de Usuário em `learn.db` (T17)

```sql
CREATE TABLE IF NOT EXISTS user_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  turn_index INTEGER NOT NULL,
  is_human INTEGER NOT NULL,     -- 1 se humano externo, 0 se subagente/sistema
  text_redacted TEXT NOT NULL,
  has_correction_marker INTEGER NOT NULL,
  preceding_tool_failed INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

### 4.2 Registro de Adoção no `manifest.json` (T18)

Entradas adotadas recebem a propriedade booleana `adopted: true`:
```json
{
  "harness": "claude",
  "target_file": ".claude/plugins/installed_plugins.json",
  "key_path": "/plugins/pi-harness-local",
  "sha256_pre": "...",
  "sha256_post": "...",
  "installed_at": "...",
  "backup_path": "...",
  "adopted": true
}
```

### 4.3 Formato de Saída do `pinga learn audit` (T19)

```json
{
  "no_verify_audit": {
    "tool_calls_flagged": 3,
    "git_commits_bypassed": 1,
    "clean_ratio": 0.667
  },
  "lessons_precision": {
    "sample_size": 30,
    "useful_count": 23,
    "precision_ratio": 0.767,
    "passes_gate": true,
    "gate_threshold": 0.70
  }
}
```

## 5. Escopo da Rodada 5

| Task | Entrega | Contrato |
|---|---|---|
| **T16** | Ingestão multi-harness (pi JSONL, opencode, hermes, fricção) | `tasks/T16-multi-ingest/` |
| **T17** | Detector de correção do usuário de alta precisão | `tasks/T17-user-correction-detector/` |
| **T18** | Subcomando `pinga adopt` com backup e registro no manifest | `tasks/T18-adopt-local/` |
| **T19** | Auditoria de `--no-verify` e avaliador de precisão de lições | `tasks/T19-learn-audit/` |

## 6. Critérios de Aceite da Rodada 5

| AC | Critério | Verificação |
|---|---|---|
| AC-16 | Multi-harness ingest conforme `tasks/T16-multi-ingest/RED.md` | `bun test tests/multi-ingest.test.ts` |
| AC-17 | Detector de correção conforme `tasks/T17-user-correction-detector/RED.md` | `bun test tests/user-correction.test.ts` |
| AC-18 | `pinga adopt` conforme `tasks/T18-adopt-local/RED.md` | `bun test tests/adopt.test.ts` |
| AC-19 | Auditoria e precisão conforme `tasks/T19-learn-audit/RED.md` | `bun test tests/audit.test.ts` |
| AC-GATE | Gate de saída da v0.1 atingido: ≥ 20 tarefas verificadas com recibo no ledger | `.pinga/pinga-stable ledger verify` |
| AC-ALL | Suíte integral de testes verde (≥ 160 testes) | `bun test` |
