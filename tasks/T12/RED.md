# RED T12 — tests/install.test.ts (+ `tests/helpers/home.ts`)

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.spawnSync`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4). Nenhum binário de harness é chamado: o adaptador Claude é escritor próprio (SPEC 0003 D16).

**Isolamento (regra do arquivo, SPEC 0003 I16):** todo caso cria `HOME`, `XDG_STATE_HOME`, `TMPDIR` e a fonte do plugin com `mkdtemp(join(realpath(tmpdir()), "pinga-t12-"))`. O helper `runPinga` recusa (lança antes de chamar o `spawn`) qualquer env cujo `HOME`, `XDG_STATE_HOME` ou `TMPDIR` não comece com `realpath(tmpdir())`, e apaga do env `XDG_CONFIG_HOME`, `XDG_DATA_HOME` e `PI_CODING_AGENT_DIR`. Nenhum caso usa `os.homedir()`, `~` ou `process.env.HOME` do processo de teste.

`REASON_CODES` não muda (SPEC 0003 §4.1): `tests/receipt.test.ts` fica intocado.

## Helper `tests/helpers/home.ts` (commitado no RED, congelado)

```ts
export const NOW = "2026-10-24T12:00:00.000Z";
export const PLUGIN_KEY = "pi-harness@pi-harness-local";
export function tmp(prefix: string): string;              // mkdtemp(join(realpath(tmpdir()), prefix))
export type FakeEnv = { home: string; state: string; tmpdir: string; source: string; env: Record<string, string> };
export function makeRealisticHome(opts?: { omit?: string[] }): FakeEnv; // omit: caminhos relativos ao HOME que não são criados
export function treeHash(dir: string): string[];           // "rel sha256" (arquivos) e "rel -> alvo" (symlinks), ordenado
export function runPinga(args: string[], env: Record<string, string>): { exit: number; stdout: string; stderr: string };
export function shadowLeftovers(tmpdir: string): string[]; // entradas "pinga-shadow-*" em tmpdir
```

`makeRealisticHome` grava (indentação 2, `\n` final) chaves de usuário que a guarda A2 tem de preservar:

| Arquivo (relativo ao HOME) | Conteúdo |
|---|---|
| `.claude/settings.json` | `{"theme":"dark","model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo user-hook"}]}]},"enabledPlugins":{"other@mkt":true}}` |
| `.claude/plugins/installed_plugins.json` | `{"version":2,"plugins":{"other@mkt":[{"scope":"user","installPath":"/x","version":"1.0.0","installedAt":"2026-01-01T00:00:00.000Z","lastUpdated":"2026-01-01T00:00:00.000Z","gitCommitSha":"abc"}]}}` |
| `.claude/plugins/known_marketplaces.json` | `{"mkt":{"source":{"source":"github","repo":"o/r"},"installLocation":"/y","lastUpdated":"2026-01-01T00:00:00.000Z"}}` |
| `.claude/CLAUDE.md` | `# notas do usuário` (não é alvo) |

`source` = `tmp("pinga-src-")` com `.claude-plugin/marketplace.json` = `{"name":"pi-harness-local","owner":{"name":"x"},"plugins":[{"name":"pi-harness","source":"./claude-plugin"}]}` e `claude-plugin/hooks/x.ts`. `env` = `PATH` do processo, `HOME=home`, `XDG_STATE_HOME=state`, `TMPDIR=tmpdir`, `PINGA_PI_HARNESS_DIR=source`, `PINGA_NOW=NOW`.

## API esperada

```ts
// src/shadow.ts
export const SHADOW_PREFIX = "pinga-shadow-";              // mkdtemp(join(realpath(tmpdir()), SHADOW_PREFIX))
export type Change = { op: "+" | "-" | "~"; pointer: string; before?: unknown; after?: unknown };
export type FileDiff = { file: string; status: "new" | "removed" | "changed"; changes: Change[] };
export function escapePointer(key: string): string;        // RFC 6901: "~" → "~0", "/" → "~1"
export function jsonPointerDiff(before: unknown, after: unknown, mask?: string[]): Change[]; // folhas, ordenado por pointer
export function withShadow<T>(realHome: string, targets: string[], fn: (shadow: string) => T | Promise<T>): Promise<T>;
export function renderDiff(sections: Array<{ harness: string; files: FileDiff[] }>): string;  // "" se nada mudou

// src/manifest.ts
export const MANIFEST_VERSION = 1;
export type Harness = "claude" | "pi" | "opencode" | "hermes" | "tuios";
export type ManifestEntry = { harness: Harness; target_file: string; key_path?: string; sha256_pre: string;
  sha256_post: string; installed_at: string; backup_path: string };
export type Manifest = { version: 1; entries: ManifestEntry[] };
export function defaultStateDir(env?: Record<string, string | undefined>): string;  // ${XDG_STATE_HOME:-$HOME/.local/state}/pinga
export function defaultManifestPath(env?: Record<string, string | undefined>): string;
export function validateManifest(x: unknown): { ok: true; manifest: Manifest } | { ok: false; errors: string[] };
export function readManifest(path: string): Manifest;     // ausente → { version: 1, entries: [] }; inválido → lança
export function writeAtomic(path: string, bytes: string | Uint8Array): void;  // temp no mesmo dir + rename
export function sha256File(path: string): string;         // 64 hex, ou "absent"
export function backupFile(stateDir: string, absPath: string): { sha256: string; backup_path: string };

// src/install.ts
export const INSTALL_EXIT = { ok: 0, usage: 2, infra: 8, foreign_key: 11, config_invalid: 12,
  revert_drift: 13, backup_corrupt: 14 } as const;
export type AdapterContext = { source: string; now: string };
export type Adapter = {
  harness: Harness;
  targets: string[];                        // arquivos relativos ao HOME
  owned: Record<string, string[]>;          // target → JSON Pointers que são entradas do pinga
  volatile: Record<string, string[]>;       // target → JSON Pointers mascarados no diff
  apply(shadowHome: string, ctx: AdapterContext): void | Promise<void>;
};
export type InstallOptions = { mode: "dry-run" | "apply" | "revert"; home: string; manifestPath?: string;
  adapters?: Adapter[]; env?: Record<string, string | undefined> };
export function checkForeign(input: { adapter: Adapter; file: string; before: unknown; after: unknown;
  changes: Change[]; manifest: Manifest }): { ok: true } | { ok: false; pointers: string[] };
export function installCmd(opts: InstallOptions): Promise<number>;

// src/adapters/claude.ts
export const CLAUDE_MARKETPLACE = "pi-harness-local";
export const CLAUDE_PLUGIN_KEY = "pi-harness@pi-harness-local";
export const claudeAdapter: Adapter;

// src/cli.ts — runCli ganha `install` (Promise<number>)
```

## Comportamento esperado

1. **`jsonPointerDiff`:** compara folhas (escalares, `{}` e `[]` vazios); arrays por índice; `+` adicionado, `-` removido, `~` alterado (com `before`/`after`); ordena por `pointer`; ponteiro de `mask` (ou descendente dele) é ignorado. Contêiner vazio que ganha filhos (ou perde todos) sem mudar de tipo não gera mudança no próprio ponteiro, só nos filhos (`{x:[]}` → `{x:[1]}` dá só `+ /x/0`); troca de tipo (`[]` → `{}`, `1` → `{}`) é `~` no ponteiro.
2. **Adaptador Claude** (escreve só na sombra; ordem das chaves preservada, chave nova no fim; `JSON.stringify(x, null, 2) + "\n"`):

   | Alvo | Entrada do pinga (`owned`) | Valor | `volatile` |
   |---|---|---|---|
   | `.claude/plugins/known_marketplaces.json` | `/pi-harness-local` | `{ source: { source: "directory", path: <source> }, installLocation: <source>, lastUpdated: now }` | `/pi-harness-local/lastUpdated` |
   | `.claude/plugins/installed_plugins.json` | `/plugins/pi-harness@pi-harness-local` | `[{ scope: "user", installPath: "<source>/claude-plugin", version: "local", installedAt: now, lastUpdated: now }]` | `…/0/installedAt`, `…/0/lastUpdated` |
   | `.claude/settings.json` | `/enabledPlugins/pi-harness@pi-harness-local` | `true` | — |

   - arquivo ausente → criado (`installed_plugins.json` nasce `{ version: 2, plugins: {} }`); `installed_plugins.json` com `version ≠ 2` → `config_invalid`;
   - `source` = `PINGA_PI_HARNESS_DIR`, senão `<repo p-inga>/../pi-harness`; sem `.claude-plugin/marketplace.json` com `name: "pi-harness-local"` e plugin `pi-harness` → stderr contém `fonte`, exit 2;
   - `now` = `PINGA_NOW`, senão `new Date().toISOString()`.
3. **Fluxo (`installCmd`)**, comum aos 3 modos de escrita:
   1. lê o manifest (inválido → stderr, exit 12); todo alvo existente que é JSON inválido → stderr com o arquivo, exit 12;
   2. `withShadow`: copia os alvos existentes (bytes, symlink como symlink) para a sombra e roda `apply` de cada adaptador na ordem; exceção do adaptador → stderr, exit 8;
   3. arquivo novo na sombra fora de `targets` → `foreign_key` (exit 11), stderr `fora dos alvos: <rel>`;
   4. por alvo: `changes = jsonPointerDiff(real, sombra, volatile[alvo])`; `checkForeign` (item 4); qualquer recusa → stderr com arquivo e ponteiros, exit 11;
   5. a sombra é removida no `finally`, sempre.
4. **`checkForeign`** (guarda A2) para um alvo JSON:
   - alvo que **não existia** antes → `ok` (o arquivo nasce do pinga);
   - todo `change.pointer` tem de ser igual a, ou descendente de, uma entrada de `owned[file]` → senão recusa com esses ponteiros;
   - **homônima**: entrada de `owned[file]` que já existe no `before` sem `ManifestEntry` com o mesmo `harness`, `target_file` e `key_path` (ou sem entrada de arquivo inteiro, `key_path` ausente) → recusa com esse ponteiro, mesmo que o valor seja igual.
5. **`--dry-run`:** stdout = `renderDiff` (seção `=== claude ===`; por arquivo `--- <rel>` ou `--- <rel> (novo)`; por mudança `+ <ptr>: <json>`, `- <ptr>`, `~ <ptr>: <json> → <json>`; valor volátil impresso como `"<volatile>"`); grava `<state>/pinga/install-plan.json` = `{ diff_sha256 }` (sha256 do stdout); **zero escrita no HOME**; exit 0. Diff vazio → stdout vazio, exit 0.
6. **`--apply`:** recalcula; diff vazio → stdout vazio, nada escrito (nem manifest, nem backup), exit 0. Senão exige `install-plan.json` com o mesmo `diff_sha256` (ausente ou diferente → stderr contém `--dry-run`, exit 2). Então:
   - backup de cada alvo alterado que existia: `backups/<sha256_pre>`, bytes idênticos (reuso se já existe com o mesmo hash);
   - cópia atômica sombra → real (`writeAtomic`); `sha256(real) ≠ sha256(sombra)` → restaura os backups já aplicados, exit 8;
   - manifest atômico: por alvo que existia, uma entrada por `owned` com `key_path`; por alvo novo, uma entrada sem `key_path`, `sha256_pre: "absent"`, `backup_path: ""`; `sha256_post` = hash final; `installed_at = now`; entradas antigas do mesmo `(harness, target_file, key_path)` são substituídas;
   - apaga `install-plan.json`; imprime o diff; exit 0.
7. **`--revert`:** manifest sem entradas → stdout `nada a reverter`, exit 0. Senão, **antes de escrever qualquer coisa**:
   - todo `target_file` tem `sha256File(atual) === sha256_post` → senão stderr lista os arquivos, exit 13;
   - todo `backup_path` não vazio existe e `sha256(backup) === sha256_pre` → senão exit 14;
   - aí restaura (`writeAtomic` do backup; `"absent"` → `unlink`), confere `sha256File === sha256_pre`, grava o manifest com `entries: []`; exit 0.
8. **CLI:** `pinga install (--dry-run | --apply | --revert) [--manifest PATH] [--home PATH]`. `--home` padrão `$HOME`; `--manifest` padrão `defaultManifestPath()`, e o `install-plan.json`/`backups/` ficam no diretório do manifest. Nenhum ou mais de um modo, flag desconhecida, flag sem valor, `--home` inexistente → exit 2. A `USAGE` ganha a linha do `install`.

## Casos

Unitários:

1. `jsonPointerDiff({a:1,b:{c:2}}, {a:1,b:{c:3,d:4}})` → `[{op:"~",pointer:"/b/c",before:2,after:3},{op:"+",pointer:"/b/d",after:4}]`; `({x:[1,2]},{x:[1]})` → `[{op:"-",pointer:"/x/1",before:2}]`; chaves `"a/b"` e `"m~n"` → `/a~1b` e `/m~0n`; com `mask: ["/b"]` → `[]`; objetos iguais → `[]`; `({x:[]},{x:[1]})` → `[{op:"+",pointer:"/x/0",after:1}]`; `({x:[]},{x:{}})` → `[{op:"~",pointer:"/x",before:[],after:{}}]`.
2. `validateManifest`: aceita o exemplo da SPEC 0003 §4.2; rejeita `version: 2`, `harness: "agy"`, `sha256_pre: "xyz"`, chave desconhecida na entrada, `backup_path` ausente, e `sha256_pre: "absent"` com `backup_path` não vazio.
3. `writeAtomic` num diretório temporário: o conteúdo final é o escrito e não sobra nenhum outro arquivo no diretório. `sha256File` de caminho inexistente → `"absent"`.
4. `backupFile` duas vezes no mesmo arquivo → mesmo `backup_path` = `<state>/backups/<sha256>`, bytes idênticos, um arquivo só em `backups/`.
5. `checkForeign` com um adaptador falso (`owned: {"s.json": ["/enabledPlugins/k"]}`): mudança em `/theme` → `{ok:false, pointers:["/theme"]}`; `before` com `/enabledPlugins/k` e manifest vazio → `pointers: ["/enabledPlugins/k"]`; mesma coisa com entrada no manifest → `ok`; alvo sem `before` → `ok`.

CLI (cada caso com `makeRealisticHome()` novo):

6. **T1 dry-run:** exit 0; stdout começa com `=== claude ===`, contém os 3 arquivos e `+ /enabledPlugins/pi-harness@pi-harness-local: true`; `treeHash(home)` igual ao de antes; o manifest não existe; `install-plan.json` existe; `shadowLeftovers(tmpdir)` vazio.
7. **Apply:** `--dry-run` e `--apply` → exit 0. Depois:
   - `settings.json`: `theme`, `model`, `hooks` e `enabledPlugins["other@mkt"]` com valores iguais aos de antes (deep equal) e `enabledPlugins[PLUGIN_KEY] === true`;
   - `installed_plugins.json`: `other@mkt` igual; `plugins[PLUGIN_KEY][0]` tem `scope: "user"`, `installPath: <source>/claude-plugin`, `installedAt: NOW`;
   - `known_marketplaces.json`: `mkt` igual; `pi-harness-local.source` = `{source:"directory", path: <source>}`;
   - manifest passa no `validateManifest`, tem 3 entradas `harness: "claude"` com os `key_path` da tabela, `sha256_pre` = hashes de antes, `sha256_post` = hashes atuais, e cada backup existe com bytes = original;
   - `install-plan.json` não existe; nenhum arquivo extra em `.claude/` nem em `.claude/plugins/` além dos 3 alvos e do `CLAUDE.md`; `shadowLeftovers` vazio.
8. **Apply sem revisão:** `--apply` sem `--dry-run` → exit 2, stderr contém `--dry-run`, `treeHash` igual. `--dry-run`, depois apagar `installed_plugins.json` (o diff muda), depois `--apply` → exit 2.
9. **T2 idempotência:** depois do caso 7, `--dry-run` → exit 0 e stdout vazio; `--apply` (sem novo dry-run) → exit 0; `treeHash(home)`, bytes do manifest e número de arquivos em `backups/` iguais. O mesmo com `PINGA_NOW=2026-10-25T00:00:00.000Z` (campo volátil mascarado).
10. **T3 revert:** depois do caso 7, `--revert` → exit 0; `treeHash(home)` igual ao de antes do install; manifest com `entries: []`. Com `makeRealisticHome({ omit: [".claude/plugins/known_marketplaces.json"] })`: o apply cria o arquivo (entrada sem `key_path`, `sha256_pre: "absent"`, `backup_path: ""`) e o revert o apaga; `treeHash` volta igual.
11. **Revert com drift:** depois do caso 7, trocar `theme` para `"light"` em `settings.json` → `--revert` exit 13, stderr contém `.claude/settings.json`; os 3 alvos continuam com o `sha256_post` (nada restaurado, nem os outros dois) e o manifest não muda.
12. **Backup corrompido:** depois do caso 7, sobrescrever um backup → `--revert` exit 14; apagar um backup → exit 14; nos dois, `treeHash(home)` não muda.
13. **T5 homônima:** `enabledPlugins[PLUGIN_KEY] = false` já no `settings.json` → `--dry-run` exit 11, stderr contém `.claude/settings.json` e `/enabledPlugins/pi-harness@pi-harness-local`; `--apply` exit 11; `treeHash` igual e o manifest não existe. Variante do drift real (§B.5): `installed_plugins.json` com `plugins[PLUGIN_KEY] = [{scope:"local", projectPath:"/p", …}]` → exit 11.
14. **JSON inválido:** `settings.json` = `{ "theme": ` → `--dry-run` e `--apply` exit 12, stderr contém `.claude/settings.json`, `treeHash` igual. `installed_plugins.json` com `version: 1` → exit 12.
15. **Adaptadores falsos (via `installCmd({ adapters })`, `home` temporário):** um que grava `/theme: "light"` em `.claude/settings.json` → 11 com `/theme`; um que cria `.bashrc` na sombra → 11 com `fora dos alvos: .bashrc`; um que lança `Error("boom")` → 8. Nos três, `treeHash` igual e nenhuma sombra sobrando.
16. **`--manifest <tmp>/m.json`:** `--dry-run`/`--apply` gravam ali (e `backups/` ao lado); `defaultManifestPath` do env não existe; `--revert --manifest <tmp>/m.json` → exit 0 e `treeHash` volta.
17. **`--home A` com `HOME=B`** (ambos `makeRealisticHome`): o apply muda só `A`; `treeHash(B)` igual.
18. **Fonte inválida:** `PINGA_PI_HARNESS_DIR` sem `.claude-plugin/marketplace.json` → exit 2, stderr contém `fonte`, `treeHash` igual.
19. **CLI:** `install` sem modo → 2; `--dry-run --apply` → 2; `--home` sem valor → 2; `--home <inexistente>` → 2; `--xpto` → 2. `pinga` sem argumentos imprime uma `USAGE` que contém `pinga install`.
