# EXEC T13 — Adaptadores pi/opencode/Hermes/TUIOS e `pinga doctor` (I18)

Você é o **EXECUTOR** (`opencode/glm-5.3-flash-free`) da tarefa **T13** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T13/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T13/RED.md` e `specs/0003-p-inga-v0.1-rodada-4.md`
- **`done_when`:** `bun test tests/adapters.test.ts tests/doctor.test.ts` (e a suíte inteira `bun test` também deve passar no pre-commit).
- **`touch` permitido:** `["src/adapters/pi.ts", "src/adapters/opencode.ts", "src/adapters/hermes.ts", "src/adapters/tuios.ts", "src/adapters/claude.ts", "src/install.ts", "src/shadow.ts", "src/manifest.ts", "src/doctor.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/adapters.test.ts", "tests/doctor.test.ts", "tests/helpers/stubs.ts", "tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Zero dependências npm** (apenas Bun 1.4.4 built-ins). Não use `bunx tsc`.

## O que implementar

### 1. `src/manifest.ts`
- `sha256File(path: string): string`:
  - Use `lstatSync(path)` (com `try/catch` para inexistente -> `"absent"`):
  - Se `st.isSymbolicLink()`, retorne `sha256hex("symlink:" + readlinkSync(path))`.
  - Senão, retorne `sha256hex(readFileSync(path))`.
- `writeAtomic(path: string, bytes: string | Uint8Array | { symlink: string }): void`:
  - Se `typeof bytes === "object" && !(bytes instanceof Uint8Array) && "symlink" in bytes`:
    - Cria symlink temporário no mesmo diretório (`symlinkSync(bytes.symlink, tmpPath)`) e faz `renameSync(tmpPath, path)`.
  - Caso contrário, mantém a escrita atômica de arquivo regular.

### 2. `src/shadow.ts`
- Estenda `withShadow` para suportar também alvos que terminam em `"/"` (diretórios): se o diretório existir em `realHome`, copie recursivamente todos os arquivos e symlinks sob ele para `shadowHome`.
- Suporte arquivos JSON (`.json`), YAML (`.yaml`/`.yml` via `Bun.YAML.parse`), e arquivos inteiros / symlinks (não-JSON/YAML, ex: `.ts`, `.bak`, symlinks):
  - Para arquivos não-JSON/YAML ou symlinks, a mudança pode ser representada com `pointer: "/"` (`op: "+" | "-" | "~"`).
- Estenda `renderDiff` para suportar seções puladas (`skippedReason?: string`):
  - Se uma seção tiver `skippedReason` (ex: `"hermes ausente"`), imprima `=== <harness> (pulado: <skippedReason>) ===\n` mesmo que `files` seja vazio!

### 3. Adaptadores (`src/adapters/{pi,claude,opencode,hermes,tuios}.ts`)
Siga a tabela do item 1 e do item 8 de `tasks/T13/RED.md`:
- `src/adapters/pi.ts`:
  - `export const piAdapter: Adapter` com `harness: "pi"`, `bin: "pi-harness"`, `targets: [".pi/agent/skills/", ".pi/agent/extensions/"]`, `owned: {}`, `volatile: {}`, `apply(shadow, ctx, env)` chamando `runNative("pi-harness", ["global", "install"], shadow, env, timeoutMs)`, e `probes` (`global_status`).
- `src/adapters/claude.ts`:
  - Adicione `probes`: `plugin_list` (`["claude", "plugin", "list"]`) e `plugin_validate` (`["claude", "plugin", "validate", ctx.source]`), com `bin: "claude"` usado apenas pelo doctor (já que `apply` do `claudeAdapter` é escritor próprio e **não** exige binário `claude` no install!).
- `src/adapters/opencode.ts`:
  - `export const OPENCODE_HEADER = "// gerado por pinga (T13): não editar";`
  - `export const opencodeAdapter: Adapter` com `harness: "opencode"`, `targets: [".config/opencode/plugins/pi-harness.ts"]`:
    - `apply(shadow, ctx)` (escritor próprio, não exige binário `opencode` no install): lê os diretórios em `<ctx.source>/.pi/skills/*/SKILL.md` ordenados e grava:
      ```ts
      // gerado por pinga (T13): não editar
      // fonte: <ctx.source>
      export const SKILLS = ["sdlc-task-executor","spec-authoring"];
      export const PiHarness = async () => ({});
      ```
    - `probes`: `plugin_list` (`["opencode", "plugin", "list"]`).
- `src/adapters/hermes.ts`:
  - `export const hermesAdapter: Adapter` com `harness: "hermes"`, `bin: "hermes"`, `targets: [".hermes/plugins/pi-harness/", ".hermes/config.yaml"]`, `append: { ".hermes/config.yaml": ["/plugins/enabled"] }`.
  - `apply`: roda `runNative("hermes", ["plugins", "install", ctx.source], ...)` e depois `runNative("hermes", ["plugins", "enable", "pi-harness"], ...)`.
  - `probes`: `plugins_list` e `doctor`.
- `src/adapters/tuios.ts`:
  - `export const tuiosAdapter: Adapter` com `harness: "tuios"`, `bin: "tuios"`, `targets: [".claude/settings.json", ".hermes/config.yaml", ".claude/settings.json.tuios.bak", ".hermes/config.yaml.tuios.bak"]`, `append: { ".claude/settings.json": ["/hooks"], ".hermes/config.yaml": ["/hooks"] }`.
  - `apply`: roda `runNative("tuios", ["integration", "install", "claude-code", "opencode", "pi", "hermes"], ...)`.
  - `probes`: `integration_status`.

### 4. `src/install.ts`
- `export const ADAPTER_ORDER: readonly Harness[] = ["pi", "claude", "opencode", "hermes", "tuios"];`
- `export function runNative(bin: string, args: string[], shadow: string, env: Record<string, string | undefined>, timeoutMs: number): { exit: number | null; stdout: string; stderr: string }`:
  - Resolve o binário via `Bun.which(bin, { PATH: env.PATH ?? process.env.PATH ?? "" }) ?? bin`.
  - Roda `Bun.spawnSync([resolvedBin, ...args], { cwd: shadow, timeout: timeoutMs, env: { ...env, HOME: shadow, XDG_CONFIG_HOME: join(shadow, ".config"), XDG_DATA_HOME: join(shadow, ".local/share"), XDG_STATE_HOME: join(shadow, ".local/state"), PI_CODING_AGENT_DIR: join(shadow, ".pi/agent") }, stdout: "pipe", stderr: "pipe" })`.
  - Se `res.exitedDueToTimeout || res.exitCode === null || res.exitCode !== 0`, em `apply` lança erro de infra (`exit 8`) citando o nome do binário.
- Em `installCmd`:
  - Suporte `opts.only?: Harness`. Se `opts.only` for inválido (fora de `ADAPTER_ORDER`), retorne `2`.
  - Quando `opts.adapters` não for passado, use a lista padrão `[piAdapter, claudeAdapter, opencodeAdapter, hermesAdapter, tuiosAdapter]` (filtrada por `opts.only` se presente).
  - Validação prévia de arquivos existentes: todo arquivo `.json` alvo deve ser JSON válido (e `installed_plugins.json` com `version: 2`); todo arquivo `.yaml`/`.yml` alvo existente deve ser YAML válido via `Bun.YAML.parse` (e retornar objeto plano). Caso contrário, escreva o caminho no stderr e retorne `12`.
  - Para adaptadores que usam CLI nativo no `apply` (`pi`, `hermes`, `tuios`, isto é, que têm `adapter.bin` para o install): verifique `Bun.which(adapter.bin, { PATH: env.PATH ?? "" })`. Se `null`, pule o adaptador e registre seção `=== <harness> (pulado: <bin> ausente) ===` no `renderDiff`! (Nota: `claude` e `opencode` usam escritor próprio no `apply`, então nunca são pulados por falta de binário no install; só o `doctor` usa os binários `claude` e `opencode`).
  - **Diff e guarda por etapa** (item 1 de `tasks/T13/RED.md`):
    - Antes de rodar o `apply` de cada adaptador na sombra, tire um snapshot da sombra.
    - Após o `apply` do adaptador, verifique se apareceu algum arquivo na sombra que não casa nenhum `target` de nenhum adaptador (ex: `.bashrc`) -> stderr `"fora dos alvos: <rel>"`, exit `11`.
    - Para cada arquivo alterado na etapa:
      - Se for arquivo inteiro (dentro de diretório `target` terminado em `"/"`, ou `.ts`, ou `.bak`, ou symlink):
        - Se já existia no HOME real antes do install e não tem `ManifestEntry` (sem `key_path`) para `(adapter.harness, relPath)` -> homônima/chave alheia, stderr com `<relPath>`, exit `11`!
      - Se for JSON ou YAML estruturado:
        - Verifique `checkForeign` estendido com `adapter.append?.[file]`:
          - Mudança sob um prefixo de `append` (ex: `/plugins/enabled/0` sob `/plugins/enabled`, ou `/hooks/Stop/1` sob `/hooks`):
            - Só `op === "+"` é aceito! Se houver `op === "~"` ou `op === "-"` em ponteiro sob `append` que não foi criado pelo pinga no manifest -> recusa com o ponteiro (exit `11`)!
            - Não há checagem de homônima nos prefixos de `append`.
            - Ao gravar o manifest no `--apply`, crie uma `ManifestEntry` por ponteiro de primeiro nível acrescentado sob `append` (ex.: se `/hooks/Stop` tinha 1 item `[0]` e ganhou o item `[1]`, o ponteiro registrado no manifest é `key_path: "/hooks/Stop/1"`, ou se `/plugins/enabled` ganhou `/plugins/enabled/0`, registre `key_path: "/plugins/enabled/0"`).
  - **Idempotência de diretórios/arquivos inteiros e `append`**:
    - Se o arquivo na sombra após todas as etapas tiver exatamente o mesmo `sha256File` do arquivo no HOME real antes do install (ou se apenas campos `volatile` mudaram), então **não há mudança real** naquele arquivo! Quando todos os adaptadores resultam em 0 mudanças reais (e 0 adaptadores pulados com mudanças), `--dry-run` imprime `""` (vazio)!
  - **Revert**:
    - Para todos os `target_file` únicos no manifest: confira `sha256File(join(home, target_file)) === entry.sha256_post`.
    - Para restaurar: se `sha256_pre === "absent"`, remova o arquivo/symlink (`unlinkSync` / `rmSync`). Se `sha256_pre !== "absent"`, restaure do backup (se o backup era symlink ou arquivo regular).

### 5. `src/doctor.ts`
Implemente e exporte `DOCTOR_STATUSES`, `DoctorStatus`, `DoctorRecord`, `Probe`, `EMPTY_SHA256`, `law2For`, `finalizeRecord`, `DoctorOptions`, `runDoctor` e `doctorCmd` conforme os itens 7 a 12 de `tasks/T13/RED.md`:
- Ordem exata dos 9 registros:
  1. `manifest/integrity`
  2. `pi/global_status`
  3. `claude/plugin_list`
  4. `claude/plugin_validate`
  5. `opencode/plugin_list`
  6. `hermes/plugins_list`
  7. `hermes/doctor`
  8. `tuios/integration_status`
  9. `llm/models`
- Passe todo registro por `finalizeRecord` antes de retornar/imprimir!
- Em `doctorCmd`:
  - Valide `--only`: se fornecido, deve ser um de `["pi", "claude", "opencode", "hermes", "tuios", "llm", "manifest"]`; senão retorne `2`.
  - Se `--json`, imprima `JSON.stringify(records, null, 2) + "\n"`.
  - Sem `--json`, imprima uma linha por registro: `${r.status} ${r.harness}/${r.check}: ${r.detail}`.
  - Retorne `1` se algum registro tiver `status === "broken"`, senão `0`.

### 6. `src/cli.ts`
- Em `install`, aceite `--only <HARNESS>`.
- Adicione o subcomando `doctor`:
  `pinga doctor [--json] [--only H] [--endpoint URL] [--home PATH] [--manifest PATH]`
- Atualize `USAGE` com `pinga doctor` e `[--only H]` no `install`.

## Regras de Git e Finalização
1. Rode `bun test tests/adapters.test.ts tests/doctor.test.ts` e `bun test` até que **todos** os testes passem.
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` foi modificado.
3. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add src/adapters/pi.ts src/adapters/opencode.ts src/adapters/hermes.ts src/adapters/tuios.ts src/adapters/claude.ts src/install.ts src/shadow.ts src/manifest.ts src/doctor.ts src/cli.ts
   git commit -m "feat(T13): adaptadores pi/opencode/Hermes/TUIOS e pinga doctor (I18)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN.
