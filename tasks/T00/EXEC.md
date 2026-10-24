Você é o EXECUTOR da T00 (opencode opencode/deepseek-v4.1-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `e55e26e` (`test(T00): RED esqueleto do repo e .gitignore`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["package.json", "tsconfig.json", "mise.toml", "hk.pkl", ".gitignore", "README.md", "testdata/.keep"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/repo.test.ts"]`
- Nunca `git add .`/`-A`: sempre caminhos explícitos. Nunca `--no-verify`. Nunca push (não há remote nesta rodada).
- Nenhuma dependência npm. Só built-ins do Bun 1.4.4: `bun:test`, `bun:sqlite`, `Bun.YAML`, `Bun.spawn`, `node:crypto`, `node:fs`, `node:path`, `node:os`.
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas. Não tente uma terceira vez.
- Não declare "passou" sem colar a saída real do `done_when`. Status só em `pass`, `fail`, `blocked` ou `not run`.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não toque nem adicione `tasks/T00/EXEC.md` no commit.

== 2. CONTRATO DA T00 (O QUE IMPLEMENTAR) ==
Leia `tasks/T00/PLAN.md`, `tasks/T00/RED.md` e `tests/repo.test.ts`.
Crie os 7 arquivos de `touch`:

1. `package.json`:
   - `"name": "p-inga"`, `"version": "0.1.0"`, `"private": true`, `"type": "module"`
   - `"scripts": { "test": "bun test" }`
   - Sem `"dependencies"` (zero dependências de runtime).

2. `tsconfig.json`:
   - `"compilerOptions": { "strict": true, "target": "ESNext", "module": "ESNext", "moduleResolution": "bundler", "types": ["bun"] }`

3. `mise.toml`:
   - Seção `[tools]` com `bun = "1.4.4"` e `hk = "1.24.0"` (versões exatas instaladas na máquina).
   - Seção `[tasks.pre-commit]` cujo `run` contenha `"bun test"`.

4. `hk.pkl`:
   - Configuração do `hk` 1.24.0 cujo hook `"pre-commit"` execute `check = "mise run pre-commit"`:
     ```pkl
     amends "package://github.com/jdx/hk/releases/download/v1.24.0/hk@1.24.0#/Config.pkl"

     hooks {
         ["pre-commit"] {
             steps {
                 ["mise-pre-commit"] {
                     check = "mise run pre-commit"
                 }
             }
         }
     }
     ```

5. `.gitignore`:
   - Deve ignorar: `raw/`, `state/`, `*.db`, `*.db-wal`, `*.db-shm`, `runs/`, `.pinga/`, `node_modules/`.
   - NÃO deve ignorar: `testdata/fixtures/a.jsonl`, `specs/0001-p-inga-v0.1.md`, `tasks/T00/PLAN.md`, `tasks/T00/EVAL.md`.

6. `README.md`:
   - Breve descrição do repo `p-inga` (Core + Ledger v0.1).

7. `testdata/.keep`:
   - Arquivo vazio para versionar o diretório `testdata/`.

== 3. VERIFICAÇÃO, HOOK E COMMIT ==
1. Rode o `done_when` exato:
   `bun test tests/repo.test.ts`
2. Rode também a suíte inteira:
   `bun test`
3. Confirme que o teste congelado não mudou:
   `git diff e55e26e..HEAD -- tests/repo.test.ts` (tem de sair vazio)
4. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add package.json tsconfig.json mise.toml hk.pkl .gitignore README.md testdata/.keep
   git commit -m "feat(T00): esqueleto do repo, mise, hk e .gitignore" -m "Co-Authored-By: deepseek-v4.1-flash-free <noreply@deepseek.com>"
   ```
5. Específico da T00: depois do commit GREEN, rode uma vez `hk install` (ou `mise exec -- hk install`) para ativar o pre-commit.

== 4. FIM OBRIGATÓRIO ==
Ao terminar, cole na sua resposta final:
1. A saída real de `bun test tests/repo.test.ts` e `bun test`
2. O sha do commit GREEN (`git rev-parse --short HEAD`)
3. A saída de `git diff --stat e55e26e..HEAD`
Depois PARE imediatamente.
