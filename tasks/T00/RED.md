# RED T00 — `tests/repo.test.ts`

Casos que o teste precisa ter. Todos devem falhar antes do GREEN, porque os arquivos ainda não existem. Use `bun:test`. Para o `.gitignore`, use `Bun.spawnSync(["git", "check-ignore", "-q", "--no-index", caminho])`: exit 0 = ignorado, exit 1 = não ignorado. O `--no-index` é obrigatório: sem ele, um arquivo já trackeado nunca aparece como ignorado e o teste passa sem testar nada.

1. **package.json**
   - `type === "module"` e `private === true`
   - `scripts.test === "bun test"`
   - não tem `dependencies`, ou é um objeto vazio (D4: zero dependências de runtime)
2. **mise.toml**
   - contém `bun = "1.4.4"` (versão exata, nunca `latest`)
   - contém uma linha `hk = "<versão exata>"`
   - tem `[tasks.pre-commit]` cujo `run` contém `bun test`
3. **hk.pkl**: o hook `pre-commit` roda `mise run pre-commit`
4. **tsconfig.json**: `compilerOptions.strict === true`
5. **.gitignore**, com estes caminhos **ignorados**:
   - `raw/a.jsonl`
   - `state/learn.db`
   - `x.db`
   - `runs/T00/1/out.txt`
   - `.pinga/pinga-stable`
   - `.pinga/stable.json`
   - `node_modules/x`
6. **.gitignore**, com estes caminhos **não ignorados**:
   - `testdata/fixtures/a.jsonl` (fixtures sintéticas são versionadas)
   - `specs/0001-p-inga-v0.1.md`
   - `tasks/T00/PLAN.md`
   - `tasks/T00/EVAL.md`
