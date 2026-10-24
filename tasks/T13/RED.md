# RED T13 — tests/adapters.test.ts + tests/doctor.test.ts (+ `tests/helpers/stubs.ts`)

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.spawn`, `Bun.spawnSync`, `Bun.serve`, `Bun.which`, `Bun.YAML`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4).

**Isolamento (SPEC 0003 I16):** valem as regras da T12 (`tests/helpers/home.ts`: `HOME`, `XDG_STATE_HOME`, `TMPDIR` e fonte em `mkdtemp`; `runPinga` recusa env fora de `realpath(tmpdir())`). **Nenhum binário real de harness é chamado:** o `PATH` de todo spawn é `<stubs>:/usr/bin:/bin` (ou só `/usr/bin:/bin`), e `bun` é chamado pelo caminho absoluto `process.execPath`. Se `claude`, `pi`, `pi-harness`, `opencode`, `hermes` ou `tuios` existirem em `/usr/bin` ou `/bin`, os casos que exigem ausência de binário usam um `PATH` só com um diretório temporário vazio mais `dirname(process.execPath)` (o helper decide com `Bun.which`).

Os casos de `doctor` com endpoint falso usam `Bun.spawn` **assíncrono** + `await proc.exited` (o `Bun.serve` roda no processo do teste; ver RED da T08).

`REASON_CODES` não muda (SPEC 0003 §4.1).

## Helper `tests/helpers/stubs.ts` (commitado no RED, congelado)

```ts
export const STUB_NAMES = ["claude", "pi-harness", "opencode", "hermes", "tuios"] as const;
export type StubName = (typeof STUB_NAMES)[number];
export function writeStubs(binDir: string, overrides?: Partial<Record<StubName, string>>): void;
export function readStubLog(logPath: string): Array<{ name: StubName; home: string; args: string[] }>;
export function makeHarnessHome(): FakeEnv & { bin: string; log: string };  // makeRealisticHome + fixtures abaixo
```

Cada stub é um arquivo JavaScript sem extensão, com shebang absoluto `#!<process.execPath>` e `chmod 0755` (sem tipos TS; não depende de `bun` no `PATH`), que primeiro acrescenta `{name, home: $HOME, args}` (JSON por linha) em `$STUB_LOG`. Comportamento padrão (`overrides` troca o corpo inteiro de um stub):

| Stub | Argumentos | Efeito padrão |
|---|---|---|
| `pi-harness` | `global install` | symlinks `$PI_CODING_AGENT_DIR/skills/<s>` → `$PINGA_PI_HARNESS_DIR/.pi/skills/<s>` para `s ∈ {sdlc-task-executor, spec-authoring}`; idempotente |
| `pi-harness` | `global status --json` | stdout `{"installed":true}`, exit 0 |
| `hermes` | `plugins install <dir>` | grava `$HOME/.hermes/plugins/pi-harness/plugin.yaml` = `name: pi-harness\n` |
| `hermes` | `plugins enable pi-harness` | reescreve `$HOME/.hermes/config.yaml` acrescentando `pi-harness` a `plugins.enabled` (preserva o resto; idempotente) |
| `hermes` | `plugins list` / `doctor` | `pi-harness  enabled` / `all checks passed`, exit 0 |
| `tuios` | `integration install claude-code opencode pi hermes` | acrescenta `{"hooks":[{"type":"command","command":"tuios hook claude-code"}]}` ao fim de `hooks.Stop` em `$HOME/.claude/settings.json` (se ainda não está) e cria `$HOME/.claude/settings.json.tuios.bak` só se ele não existe |
| `tuios` | `integration status` | `claude-code installed\nopencode current\npi installed\nhermes installed`, exit 0 |
| `claude` | `plugin list` | `pi-harness@pi-harness-local\n  Scope: user\n  Status: ✔ enabled\n`, exit 0 |
| `claude` | `plugin validate <dir>` | `✔ Validation passed`, exit 0 |
| `opencode` | `plugin list` | `pi-harness\nherdr-opencode`, exit 0 |

`makeHarnessHome` acrescenta ao HOME da T12: `.config/opencode/opencode.json` = `{"plugins":["github:EduardoShibukawa/G-Inga"]}` (a divergência real de §A.2, que nunca pode ser tocada), `.hermes/config.yaml` = `model: qwen\nplugins:\n  enabled: []\n`, `.pi/agent/settings.json` = `{"defaultModel":"qwen3.8-flash"}`; e à fonte: `.pi/skills/{sdlc-task-executor,spec-authoring}/SKILL.md`. `env` ganha `PATH=<bin>:/usr/bin:/bin`, `STUB_LOG=<log>`.

## API esperada

```ts
// src/install.ts (estende a T12; compatível)
export const ADAPTER_ORDER: readonly Harness[] = ["pi", "claude", "opencode", "hermes", "tuios"];
export type Adapter = T12.Adapter & {
  bin?: string;                               // binário nativo; ausente no PATH → adaptador pulado
  append?: Record<string, string[]>;          // target → prefixos só-acréscimo (sem homônima)
  probes: Probe[];                            // usados pelo doctor
};
//   targets: entrada terminada em "/" é raiz de diretório (todo arquivo/symlink sob ela é alvo)
//   InstallOptions.only?: Harness
export function runNative(bin: string, args: string[], shadow: string, env: Record<string, string | undefined>,
  timeoutMs: number): { exit: number | null; stdout: string; stderr: string };
//   env do filho: HOME=shadow, XDG_CONFIG_HOME=shadow/.config, XDG_DATA_HOME=shadow/.local/share,
//   XDG_STATE_HOME=shadow/.local/state, PI_CODING_AGENT_DIR=shadow/.pi/agent; o resto herdado

// src/manifest.ts — sha256File(symlink) = sha256("symlink:" + readlink); writeAtomic aceita { symlink: alvo }
// src/shadow.ts — JSON e YAML (Bun.YAML.parse) estruturados; outros arquivos e symlinks comparados por sha256File

// src/adapters/{pi,opencode,hermes,tuios}.ts
export const piAdapter: Adapter; export const opencodeAdapter: Adapter;
export const hermesAdapter: Adapter; export const tuiosAdapter: Adapter;
export const OPENCODE_HEADER = "// gerado por pinga (T13): não editar";

// src/doctor.ts
export const DOCTOR_STATUSES = ["ok", "degraded", "broken", "unverified"] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];
export type DoctorRecord = { harness: string; check: string; status: DoctorStatus;
  law2: "pass" | "fail" | "blocked" | "not run"; cmd: string[] | null; exit: number | null;
  stdout_sha256: string | null; duration_ms: number | null; detail: string };
export type Probe = { check: string; cmd: (ctx: { source: string }) => string[];
  classify: (r: { exit: number; stdout: string }) => { status: "ok" | "degraded" | "broken"; detail: string } };
export const EMPTY_SHA256: string;                     // sha256("")
export function law2For(status: DoctorStatus, cause?: "missing" | "filtered" | "timeout" | "infra" | "empty"):
  DoctorRecord["law2"];
export function finalizeRecord(r: DoctorRecord): DoctorRecord;   // aplica I18
export type DoctorOptions = { home: string; only?: string; endpoint?: string; manifestPath?: string;
  env?: Record<string, string | undefined> };
export function runDoctor(opts: DoctorOptions): Promise<DoctorRecord[]>;
export function doctorCmd(opts: DoctorOptions & { json: boolean }): Promise<number>;
```

## Comportamento esperado — adaptadores e install

1. **Alvos, posse e guarda (estende a T12, item 4):**

   | Adaptador | Mecanismo (só na sombra) | `targets` | `owned` / `append` |
   |---|---|---|---|
   | pi | `pi-harness global install` | `.pi/agent/skills/`, `.pi/agent/extensions/` | arquivo inteiro (cada symlink novo) |
   | claude | escritor próprio (T12) | os 3 da T12 | os da T12 |
   | opencode | escritor próprio | `.config/opencode/plugins/pi-harness.ts` | arquivo inteiro |
   | hermes | `hermes plugins install <source>` + `hermes plugins enable pi-harness` | `.hermes/plugins/pi-harness/`, `.hermes/config.yaml` | dir: arquivo inteiro; `config.yaml`: `append` `/plugins/enabled` |
   | tuios | `tuios integration install claude-code opencode pi hermes` | `.claude/settings.json`, `.hermes/config.yaml`, `.claude/settings.json.tuios.bak`, `.hermes/config.yaml.tuios.bak` | `append` `/hooks` nos dois configs; `.tuios.bak`: arquivo inteiro |

   - **só-acréscimo:** sob um prefixo de `append`, só `+` é aceito; `~` ou `-` em ponteiro que já existia → `foreign_key` com o ponteiro. Não há checagem de homônima nesses prefixos (o TUIOS é "terceiro conhecido", §A.4).
   - **arquivo inteiro** (não-JSON/YAML, symlink): novo → aceito; já existia e muda/some sem `ManifestEntry` sem `key_path` para ele → `foreign_key`; já existia e o adaptador o escreveria sem estar no manifest (homônima) → `foreign_key`.
   - **diff por etapa:** os adaptadores rodam na ordem `ADAPTER_ORDER` numa sombra só; o diff de cada um é calculado entre o estado da sombra antes e depois dele e sai na seção `=== <harness> ===`, na ordem. A guarda de cada etapa usa o `owned`/`append` daquele adaptador.
   - **manifest:** uma entrada por ponteiro acrescentado sob `append` (ex.: tuios `/hooks/Stop/1`), além das regras da T12. Entradas de harnesses diferentes no mesmo arquivo compartilham `sha256_pre` (antes da primeira etapa) e `sha256_post` (depois da última).
2. **opencode** grava `pi-harness.ts`: linha 1 `OPENCODE_HEADER`, linha 2 `// fonte: <source>`, depois `export const SKILLS = [...]` com os nomes de `<source>/.pi/skills/*/SKILL.md` em ordem e `export const PiHarness = async () => ({});`. Bytes são função só de `source` (determinístico). `opencode.json` **nunca** é alvo.
3. **binário ausente** (`Bun.which(bin, { PATH })` nulo): o adaptador é pulado; a seção vira `=== <harness> (pulado: <bin> ausente) ===`, sem mudanças; o resto segue; exit 0.
4. **CLI nativo** com exit ≠ 0 ou timeout (`PINGA_INSTALL_TIMEOUT_MS`, padrão 60000) na sombra → stderr com o binário e o exit, exit 8, nada escrito no real.
5. **`--only <harness>`** (`install` e `doctor`): roda só aquele adaptador. Valor fora de `ADAPTER_ORDER` (no doctor também `llm` e `manifest`) → exit 2.
6. O CLI nativo **nunca** roda com o HOME real: no `--apply`, os bytes vêm da sombra (D15); o `$HOME` de toda linha do `STUB_LOG` está sob `<TMPDIR>/pinga-shadow-`.

## Comportamento esperado — doctor

7. **Registros**, nesta ordem: `manifest/integrity`, `pi/global_status`, `claude/plugin_list`, `claude/plugin_validate`, `opencode/plugin_list`, `hermes/plugins_list`, `hermes/doctor`, `tuios/integration_status`, `llm/models`. Cada um vira um `DoctorRecord` (SPEC 0003 §4.4) com `detail` ≤ 200.
8. **Probes de harness** (`cmd` rodado com o HOME do `--home`, `PATH` do env, timeout `PINGA_DOCTOR_TIMEOUT_MS`, padrão 30000):

   | Check | `cmd` | `ok` | `degraded` | `broken` |
   |---|---|---|---|---|
   | `pi/global_status` | `pi-harness global status --json` | stdout é JSON válido | JSON inválido | exit ≠ 0 |
   | `claude/plugin_list` | `claude plugin list` | bloco de `pi-harness@pi-harness-local` (até a próxima linha vazia) sem `disabled` | chave ausente, ou bloco com `disabled` | exit ≠ 0 |
   | `claude/plugin_validate` | `claude plugin validate <source>` | exit 0 | — | exit ≠ 0 |
   | `opencode/plugin_list` | `opencode plugin list` | alguma linha contém `pi-harness` | nenhuma | exit ≠ 0 |
   | `hermes/plugins_list` | `hermes plugins list` | linha com `pi-harness` e `enabled` (e sem `disabled`) | linha sem `enabled`, ou ausente | exit ≠ 0 |
   | `hermes/doctor` | `hermes doctor` | exit 0 | — | exit ≠ 0 |
   | `tuios/integration_status` | `tuios integration status` | toda linha não vazia contém `installed` ou `current` e nenhuma contém `not installed` | alguma `not installed` | exit ≠ 0 |

   Com exit 0 e stdout vazio (só espaços) → `degraded`, `detail` contém `saída vazia` (`law2For("degraded","empty") = "fail"`). Binário ausente → `unverified`, `law2: "blocked"`, `cmd: null`. Timeout → `unverified`, `law2: "not run"`, `detail` contém `timeout`. `--only` → os outros são `unverified`, `law2: "not run"`, `cmd: null`, `detail: "filtrado por --only"`.
9. **`manifest/integrity`** (checagem interna, `cmd: ["pinga:internal", "manifest"]`, `exit: 0`, stdout = relatório `<sha256_post> <atual> <target>` por arquivo): todos iguais → `ok`; algum diferente → `degraded`; alvo ausente com `sha256_post ≠ "absent"` ou manifest inválido → `broken`; manifest ausente ou sem entradas → `unverified`, `law2: "not run"`, `detail` contém `nada instalado`.
10. **`llm/models`**: `attestFromEndpoint(endpoint, null, { timeoutMs })` (T08). `endpoint` = `--endpoint` › `PINGA_JUDGE_ENDPOINT` › `http://127.0.0.1:8089`. `cmd: ["GET", "<endpoint>/v1/models"]`. `ok` → `exit: 0`, `stdout_sha256 = sha256(served)`, `detail: "served <id>"`; `model_unattested` (vazio ou ambíguo) → `degraded`; `infra` → `unverified`, `law2: "blocked"`, `exit: null`.
11. **`finalizeRecord` (I18):** `status: "ok"` com `cmd === null`, `exit !== 0`, `stdout_sha256 === null` ou `=== EMPTY_SHA256` → `status: "unverified"`, `law2: "not run"`, `detail` prefixado por `rebaixado: `. Aplicado a todo registro antes de imprimir. `law2For`: `ok → pass`; `degraded`, `broken → fail`; `unverified` → `blocked` para `missing`/`infra`, `not run` para `filtered`/`timeout` e sem causa.
12. **CLI:** `pinga doctor [--json] [--only H] [--endpoint URL] [--home PATH] [--manifest PATH]`. `--json` → stdout é um array JSON dos registros (só as 9 chaves de §4.4, nessa ordem); sem `--json` → uma linha por registro: `<status> <harness>/<check>: <detail>`. Exit 1 se algum `broken`, senão 0. Flag desconhecida ou sem valor → 2. A `USAGE` ganha a linha do `doctor` e `[--only H]` no `install`.

## Casos — `tests/adapters.test.ts`

1. `sha256File` de um symlink = `sha256("symlink:" + alvo)`; `writeAtomic(p, { symlink: "x" })` cria o symlink sem sobra no diretório.
2. **Dry-run completo:** exit 0; seções `pi`, `claude`, `opencode`, `hermes`, `tuios` nessa ordem; `treeHash(home)` igual; todo `home` do `STUB_LOG` ≠ `home` do teste e começa com `<tmpdir>/pinga-shadow-`; esses diretórios não existem mais.
3. **Apply** (depois do dry-run): exit 0; `.pi/agent/skills/spec-authoring` é symlink para `<source>/.pi/skills/spec-authoring`; `pi-harness.ts` começa com `OPENCODE_HEADER` e `SKILLS` = `["sdlc-task-executor","spec-authoring"]`; bytes de `opencode.json` e de `.pi/agent/settings.json` iguais; `plugin.yaml` do Hermes existe; `config.yaml` tem `model: qwen` e `plugins.enabled` = `["pi-harness"]`; `settings.json`: `hooks.Stop[0]` igual ao do usuário e `hooks.Stop[1]` é o do tuios, `enabledPlugins[PLUGIN_KEY] === true`; `.claude/settings.json.tuios.bak` existe; manifest válido com entradas dos 5 harnesses, entre elas `{harness:"tuios", target_file:".claude/settings.json", key_path:"/hooks/Stop/1"}`; nenhum `home` do `STUB_LOG` é o `home` do teste.
4. **Idempotência:** depois do caso 3, `--dry-run` → exit 0 e stdout vazio; `treeHash` e manifest iguais.
5. **Revert:** depois do caso 3, `--revert` → exit 0 e `treeHash(home)` igual ao de antes do install (symlinks, `pi-harness.ts`, `plugin.yaml` e `.tuios.bak` somem; `settings.json` e `config.yaml` voltam byte a byte).
6. **`--only opencode`:** stdout só com `=== opencode ===`; o apply muda só `pi-harness.ts`; manifest só com `harness: "opencode"`; o `STUB_LOG` não tem nenhuma linha. `--only agy` → exit 2.
7. **Binário ausente:** sem o stub `hermes` → dry-run exit 0, seção `=== hermes (pulado: hermes ausente) ===`, as outras 4 com mudanças.
8. **CLI nativo falha:** override do `pi-harness` com exit 3 → `--dry-run` exit 8, stderr contém `pi-harness`, `treeHash` igual, nenhuma `pinga-shadow-` em `tmpdir`.
9. **Só-acréscimo violado:** override do `tuios` que troca `hooks.Stop[0].hooks[0].command` → exit 11, stderr contém `/hooks/Stop/0/hooks/0/command`.
10. **Homônima de arquivo:** `.config/opencode/plugins/pi-harness.ts` do usuário já existe → exit 11, stderr contém o caminho.
11. **Fora dos alvos:** override do `pi-harness` que também cria `$HOME/.bashrc` → exit 11, `fora dos alvos: .bashrc`.
12. **YAML inválido:** `config.yaml` = `plugins: [` → exit 12, stderr contém `.hermes/config.yaml`.
13. **Timeout do nativo:** override do `hermes` com `sleep 5` e `PINGA_INSTALL_TIMEOUT_MS=200` → exit 8 e nenhuma sombra sobrando.

## Casos — `tests/doctor.test.ts`

14. `finalizeRecord`: `ok` com `cmd: null` → `unverified`/`not run`/`rebaixado: …`; `ok` com `exit: 1` → `unverified`; `ok` com `stdout_sha256: EMPTY_SHA256` → `unverified`; `ok` completo → igual. `law2For` para as 7 combinações de item 11.
15. **Tudo saudável:** `makeHarnessHome` + `install --dry-run/--apply` + endpoint falso com `{"data":[{"id":"qwen3.5-4b"}]}` → `doctor --json` exit 0; 9 registros, todos `ok`, cada `ok` com `cmd ≠ null`, `exit === 0`, `stdout_sha256` de 64 hex ≠ `EMPTY_SHA256`; `llm/models.detail` = `served qwen3.5-4b`.
16. **T4b sem binários:** `PATH` sem stubs, `--endpoint http://127.0.0.1:9` → exit 0 (nada `broken`); nenhum `ok`; os 7 de harness `unverified`/`blocked`/`cmd: null`; `llm/models` `unverified`/`blocked`; `manifest/integrity` `unverified` (`nada instalado`).
17. **Broken:** override `claude` `plugin list` com exit 1 → `claude/plugin_list` `broken`/`fail`, `exit: 1`; `doctor` exit 1.
18. **Degraded:** `claude plugin list` com `Status: ✘ disabled` → `degraded`; com stdout vazio e exit 0 → `degraded`, `detail` contém `saída vazia`; `tuios integration status` com `pi not installed` → `degraded`; `pi-harness global status --json` com `{` → `degraded`; `hermes plugins list` com `pi-harness  disabled` → `degraded`.
19. **Timeout:** override `opencode` com `sleep 5`, `PINGA_DOCTOR_TIMEOUT_MS=200` → `opencode/plugin_list` `unverified`/`not run`, `detail` contém `timeout`.
20. **Manifest:** depois do apply do caso 15, mudar `theme` → `manifest/integrity` `degraded`; apagar `pi-harness.ts` → `broken` e exit 1; manifest com JSON inválido → `broken`.
21. **LLM:** endpoint com 2 modelos → `degraded`; HTTP 500 → `unverified`/`blocked`; `{"data":[]}` → `degraded`.
22. **`--only claude`:** `claude/*` rodam; os outros 7 `unverified`/`not run`/`filtrado por --only`/`cmd: null`; o `STUB_LOG` só tem `claude`. `--only xpto` → exit 2.
23. **Texto:** sem `--json`, 9 linhas, cada uma casando `^(ok|degraded|broken|unverified) [a-z-]+/[a-z_]+: `.
24. **Schema:** em todo JSON dos casos 15–22, cada registro tem exatamente as 9 chaves de §4.4, `status` ∈ `DOCTOR_STATUSES`, `law2` ∈ os 4 da Lei 2, e nenhum `ok` viola I18.
25. **CLI:** `--endpoint` sem valor → 2; `--xpto` → 2; a `USAGE` contém `pinga doctor`.
