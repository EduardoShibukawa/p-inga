---
mode: padrao
goal: "pinga install (I16/I17): HOME-sombra em mkdtemp, diff pré-aplicação, --apply só do diff revisado, backups por sha256, manifest atômico, guarda de chave alheia/homônima (exit 11) e JSON inválido (exit 12), --revert por hash (13/14); adaptador Claude Code."
done_when: "bun test tests/install.test.ts"
touch: ["src/install.ts", "src/manifest.ts", "src/shadow.ts", "src/adapters/claude.ts", "src/cli.ts"]
tests_frozen: ["tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 400000, minutes: 120 }
---
## Passos
- [x] commit RED: tests/install.test.ts + tests/helpers/home.ts; prove-red exit 0; PARE para revisão
- [x] GREEN: shadow.ts (mkdtemp, cópia dos alvos, diff por JSON Pointer, limpeza garantida)
- [x] GREEN: manifest.ts (schema v1, escrita atômica, backups); install.ts (guarda A2, apply, revert)
- [x] GREEN: adapters/claude.ts (marketplace, installed_plugins v2, enabledPlugins); cli ganha `install`
- [x] commit GREEN com caminhos explícitos; mise run stable; verify, judge e eval de tasks/T12/PLAN.md

## Dívidas conscientes
- Claude escrito por escritor próprio restrito às 3 entradas do pinga, não por `claude plugin install` (D16)
- revert com drift recusa (exit 13); remoção semântica e `pinga adopt` ficam para a v0.2
- diretórios vazios criados pelo install sobram depois do revert (a árvore de arquivos volta igual)

## Fora
- adaptadores pi/opencode/Hermes/TUIOS e doctor (T13); release do pinga (A6); HOME real nos testes
