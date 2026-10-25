# RED T18 — Comando `pinga adopt` (`tests/adopt.test.ts`)

## 1. Escopo e Contrato

Resolve o item de `#backlog` e decisão 16 de arquitetura: absorver entradas locais pré-existentes no `HOME` (como as 3 entradas `local` do `pi-harness` no Claude Code, plugins em `~/.config/opencode/plugins/` e extensões legadas em `~/.pi/agent/extensions/`) sem disparar erro de chave alheia/homônima (exit 11) no `pinga install`.

### 1.1 Regras de Operação
1. **Inspeção Segura (`--dry-run`)**:
   - Varre os diretórios alvo no `HOME` (`--home <path>`).
   - Identifica entradas legadas não registradas no `manifest.json`.
   - Sob `--dry-run`, emite relatório JSON das entradas localizadas e ações propostas, sem realizar qualquer mutação em disco.
2. **Aplicação com Backup (`--apply`)**:
   - Cria backup byte a byte do arquivo original em `.pinga/backups/<timestamp>/<sha256_pre>`.
   - Se a entrada for um symlink quebrado ou obsoleto, remove o link com segurança.
   - Registra a entrada no `manifest.json` com `adopted: true`, `sha256_pre` e `sha256_post`.
3. **Compatibilidade com `install` e `revert`**:
   - Após `pinga adopt --apply`, a execução subsequente de `pinga install --apply` reconhece a posse da entrada e prossegue com sucesso (exit 0, sem exit 11).
   - O comando `pinga install --revert` é capaz de restaurar o estado original através dos backups registrados no manifest.

## 2. API Esperada

```ts
// src/adopt.ts
export type AdoptableTarget = {
  harness: "claude" | "opencode" | "pi";
  target_file: string;
  key_path?: string;
  kind: "json_entry" | "file" | "symlink";
  status: "adoptable" | "broken_symlink" | "already_owned" | "missing";
};

export type AdoptResult = {
  inspected: number;
  adopted: number;
  cleaned: number;
  skipped: number;
  backups_created: string[];
};

export function classifyAdoptTarget(input: {
  target: string;
  exists: boolean;
  is_owned: boolean;
  is_broken_symlink: boolean;
}): "adoptable" | "broken_symlink" | "already_owned" | "missing" | "ignored";

export function inspectAdoptableEntries(homeDir: string, manifestPath: string): Promise<AdoptableTarget[]>;

export function adoptLocalEntries(opts: {
  homeDir: string;
  manifestPath: string;
  apply?: boolean;
}): Promise<AdoptResult>;
```

## 3. Casos de Teste (`tests/adopt.test.ts`)

1. `inspectAdoptableEntries` localiza entradas locais não registradas em fixture de HOME realista.
2. `pinga adopt --dry-run` exibe entradas a adotar sem modificar arquivos nem criar manifest.
3. `pinga adopt --apply` cria backup íntegro com SHA-256 no diretório de backups antes da mutação.
4. `pinga adopt --apply` remove symlinks apontando para caminhos inexistentes (`broken_symlink`).
5. `pinga adopt --apply` atualiza `manifest.json` registrando entradas com `adopted: true`.
6. Idempotência: rodar `pinga adopt --apply` duas vezes consecutivas não altera o estado nem duplica backups.
7. Compatibilidade com `install`: HOME com entradas adotadas permite `pinga install --apply` sem erro exit 11.
8. Compatibilidade com `revert`: `pinga install --revert` reverte modificações respeitando o manifest gerado pelo adopt.
9. Tentativa de adoção em HOME sem entradas legadas reporta 0 adoções de forma limpa.
10. Preservação de chaves de usuário não relacionadas (e.g. `theme`, `model` em `settings.json`).
