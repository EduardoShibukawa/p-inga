# EXEC T12 — `pinga install` e Adaptador Claude Code (I16 / I17)

Você é o **EXECUTOR** (`opencode/glm-5.3-flash-free`) da tarefa **T12** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T12/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T12/RED.md` e `specs/0003-p-inga-v0.1-rodada-4.md`
- **`done_when`:** `bun test tests/install.test.ts` (e a suíte inteira `bun test` também deve passar no pre-commit).
- **`touch` permitido:** `["src/install.ts", "src/manifest.ts", "src/shadow.ts", "src/adapters/claude.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Zero dependências npm** (apenas Bun 1.4.4 built-ins). Não use `bunx tsc`.

## O que implementar

### 1. `src/shadow.ts`
Exporte exatamente:
- `export const SHADOW_PREFIX = "pinga-shadow-";`
- `export type Change = { op: "+" | "-" | "~"; pointer: string; before?: unknown; after?: unknown };`
- `export type FileDiff = { file: string; status: "new" | "removed" | "changed"; changes: Change[] };`
- `escapePointer(key: string): string` -> RFC 6901: `key.replace(/~/g, "~0").replace(/\//g, "~1")`
- `jsonPointerDiff(before: unknown, after: unknown, mask?: string[]): Change[]`:
  - Compara folhas (escalares, `{}` e `[]` vazios); arrays por índice; `+` adicionado (`after`), `-` removido (`before`), `~` alterado (`before`, `after`);
  - Ordena por `pointer` lexicograficamente;
  - Se um ponteiro `p` for igual a algum item `m` de `mask` ou descendente dele (`p === m || p.startsWith(m + "/")`), é ignorado;
  - Contêiner vazio que ganha filhos (ou perde todos) sem mudar de tipo não gera mudança no próprio ponteiro, só nos filhos (`{x:[]}` -> `{x:[1]}` dá só `+ /x/0`); troca de tipo (`[]` -> `{}`, `1` -> `{}`) é `~` no ponteiro.
- `withShadow<T>(realHome: string, targets: string[], fn: (shadow: string) => T | Promise<T>): Promise<T>`:
  - Cria `const shadow = mkdtempSync(join(realpathSync(tmpdir()), SHADOW_PREFIX))` (respeitando `process.env.TMPDIR` se definido, já que `tmpdir()` no Bun/Node lê `TMPDIR`, ou `realpathSync(process.env.TMPDIR ?? tmpdir())`).
  - Copia apenas os arquivos existentes em `targets` (relativos a `realHome`) para dentro de `shadow` (bytes idênticos; symlink copiado como symlink via `symlinkSync(readlinkSync(...))`).
  - Roda `await fn(shadow)` em `try { ... } finally { rmSync(shadow, { recursive: true, force: true }); }`.
- `renderDiff(sections: Array<{ harness: string; files: FileDiff[] }>): string`:
  - Ignora seções sem arquivos alterados (`files.length === 0`); se nenhuma seção tiver mudanças, retorna `""`.
  - Para cada seção:
    - Linha `=== <harness> ===`
    - Para cada arquivo em `files`:
      - Linha `--- <file>` (ou `--- <file> (novo)` se `status === "new"`, `--- <file> (removido)` se `status === "removed"`)
      - Para cada mudança em `changes`:
        - `+ <pointer>: <JSON.stringify(after)>`
        - `- <pointer>`
        - `~ <pointer>: <JSON.stringify(before)> → <JSON.stringify(after)>`
  - Termina com `\n` quando não vazio.

### 2. `src/manifest.ts`
Exporte exatamente:
- `export const MANIFEST_VERSION = 1;`
- `export type Harness = "claude" | "pi" | "opencode" | "hermes" | "tuios";`
- `export type ManifestEntry = { harness: Harness; target_file: string; key_path?: string; sha256_pre: string; sha256_post: string; installed_at: string; backup_path: string };`
- `export type Manifest = { version: 1; entries: ManifestEntry[] };`
- `defaultStateDir(env: Record<string, string | undefined> = process.env): string`:
  - `const base = (env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0) ? env.XDG_STATE_HOME : join(env.HOME ?? homedir(), ".local/state");`
  - `return join(base, "pinga");`
- `defaultManifestPath(env: Record<string, string | undefined> = process.env): string` -> `join(defaultStateDir(env), "manifest.json")`
- `validateManifest(x: unknown): { ok: true; manifest: Manifest } | { ok: false; errors: string[] }`:
  - Valida `version === 1`, `entries` array; cada entrada só pode ter as chaves `harness`, `target_file`, `key_path`, `sha256_pre`, `sha256_post`, `installed_at`, `backup_path` (chave extra -> erro);
  - `harness` em `["claude", "pi", "opencode", "hermes", "tuios"]`;
  - `sha256_pre`: 64 hex minúsculo ou `"absent"`; `sha256_post`: 64 hex minúsculo;
  - `backup_path`: string obrigatória; se `sha256_pre === "absent"`, `backup_path` deve ser `""`; se `sha256_pre !== "absent"`, `backup_path` não pode ser vazio.
- `readManifest(path: string): Manifest`:
  - Se `!existsSync(path)`, retorna `{ version: 1, entries: [] }`.
  - Senão faz parse + `validateManifest`; se inválido, lança `Error`.
- `writeAtomic(path: string, bytes: string | Uint8Array): void`:
  - `mkdirSync(dirname(path), { recursive: true })`
  - Escreve em arquivo temporário no mesmo diretório (`join(dirname(path), \`.tmp-\${process.pid}-\${randomUUID()}\`)`) e faz `renameSync(tmpPath, path)` (limpando o tmp se falhar).
- `sha256File(path: string): string`:
  - Se `!existsSync(path)`, retorna `"absent"`; senão retorna o sha256 hex de `readFileSync(path)`.
- `backupFile(stateDir: string, absPath: string): { sha256: string; backup_path: string }`:
  - Calcula `sha256 = sha256File(absPath)`; `backup_path = join(stateDir, "backups", sha256)`.
  - Se `!existsSync(backup_path)`, copia atomicamente os bytes de `absPath` para `backup_path`.
  - Retorna `{ sha256, backup_path }`.

### 3. `src/adapters/claude.ts`
Exporte:
- `export const CLAUDE_MARKETPLACE = "pi-harness-local";`
- `export const CLAUDE_PLUGIN_KEY = "pi-harness@pi-harness-local";`
- `export const claudeAdapter: Adapter`:
  - `harness: "claude"`
  - `targets`: `[".claude/plugins/known_marketplaces.json", ".claude/plugins/installed_plugins.json", ".claude/settings.json"]`
  - `owned`:
    - `".claude/plugins/known_marketplaces.json"`: `["/pi-harness-local"]`
    - `".claude/plugins/installed_plugins.json"`: `["/plugins/pi-harness@pi-harness-local"]`
    - `".claude/settings.json"`: `["/enabledPlugins/pi-harness@pi-harness-local"]`
  - `volatile`:
    - `".claude/plugins/known_marketplaces.json"`: `["/pi-harness-local/lastUpdated"]`
    - `".claude/plugins/installed_plugins.json"`: `["/plugins/pi-harness@pi-harness-local/0/installedAt", "/plugins/pi-harness@pi-harness-local/0/lastUpdated"]`
    - `".claude/settings.json"`: `[]`
  - `apply(shadowHome, ctx)`:
    - Atualiza/cria os 3 arquivos dentro de `shadowHome` preservando as chaves existentes e escrevendo `JSON.stringify(obj, null, 2) + "\n"`, exatamente como na tabela de `tasks/T12/RED.md` item 2.
    - Se `installed_plugins.json` existir e tiver `version !== 2`, lança um erro marcado como `config_invalid` (para `installCmd` sair com exit 12).

### 4. `src/install.ts`
Implemente e exporte `INSTALL_EXIT`, `AdapterContext`, `Adapter`, `InstallOptions`, `checkForeign` e `installCmd(opts: InstallOptions): Promise<number>` seguindo todos os itens 3 a 8 de `tasks/T12/RED.md`:
- `checkForeign`:
  - Se `input.before === undefined` -> `{ ok: true }`.
  - Verifica se todo `change.pointer` em `input.changes` é igual a, ou descendente de (`ptr === ownedPtr || ptr.startsWith(ownedPtr + "/")`), algum `ownedPtr` de `input.adapter.owned[input.file] ?? []`.
  - Verifica **homônima**: para cada `ownedPtr` em `input.adapter.owned[input.file] ?? []`, se `ownedPtr` já existe no objeto `input.before` (resolvendo os segmentos RFC 6901 de `ownedPtr` em `input.before`), verifica se `input.manifest.entries` possui entrada com `harness === input.adapter.harness && target_file === input.file && (e.key_path === ownedPtr || e.key_path === undefined)`. Se não possuir, adiciona `ownedPtr` aos ponteiros recusados!
  - Se houver ponteiros recusados, retorna `{ ok: false, pointers: Array.from(new Set(badPointers)).sort() }`; senão `{ ok: true }`.
- Em `installCmd`:
  - Use `env = opts.env ?? process.env`.
  - Quando `opts.mode !== "revert"` e o adaptador `claude` estiver na lista (ou quando usando os adaptadores padrão `[claudeAdapter]`): valide a fonte `source = env.PINGA_PI_HARNESS_DIR ?? resolve(ROOT, "../pi-harness")`. Verifique se `join(source, ".claude-plugin/marketplace.json")` existe e é JSON válido com `name === "pi-harness-local"` e `plugins` contendo `{ name: "pi-harness" }`. Se não for, escreva erro contendo `"fonte"` no stderr e retorne `2`!
  - Siga rigorosamente os fluxos de `--dry-run`, `--apply` e `--revert` detalhados em `tasks/T12/RED.md` (itens 3, 5, 6, 7 e 8).
  - Nota importante sobre idempotência com campos voláteis (caso 9):
    - As mudanças (`changes`) de cada arquivo são calculadas com `jsonPointerDiff(beforeObj, afterObj, adapter.volatile[file])`.
    - Se para todos os arquivos de todos os adaptadores `changes.length === 0` (e nenhum arquivo novo foi criado nem removido), o diff é **vazio**! Nesse caso, `--dry-run` imprime `""` e retorna `0`, e `--apply` não escreve nada no HOME nem no manifest nem em backups e retorna `0`!

### 5. `src/cli.ts`
- Adicione o subcomando `install`:
  `pinga install (--dry-run | --apply | --revert) [--manifest PATH] [--home PATH]`
- Atualize `USAGE` incluindo `pinga install`.

## Regras de Git e Finalização
1. Rode `bun test tests/install.test.ts` e `bun test` até que **todos** os testes passem.
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` (`src/install.ts`, `src/manifest.ts`, `src/shadow.ts`, `src/adapters/claude.ts`, `src/cli.ts`) foi modificado.
3. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add src/install.ts src/manifest.ts src/shadow.ts src/adapters/claude.ts src/cli.ts
   git commit -m "feat(T12): pinga install e adaptador Claude Code (I16 / I17)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN.
