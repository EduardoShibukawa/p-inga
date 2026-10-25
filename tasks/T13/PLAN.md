---
mode: padrao
goal: "Adaptadores pi, opencode, Hermes e TUIOS (CLI nativo só na sombra, ordem pi→claude→opencode→hermes→tuios, --only, alvos de diretório, acréscimo-só) e pinga doctor com ok|degraded|broken|unverified: ok só com cmd, exit 0 e stdout não vazio (I18); LLM via attestFromEndpoint."
done_when: "bun test tests/adapters.test.ts tests/doctor.test.ts"
touch: ["src/adapters/pi.ts", "src/adapters/opencode.ts", "src/adapters/hermes.ts", "src/adapters/tuios.ts", "src/adapters/claude.ts", "src/install.ts", "src/shadow.ts", "src/manifest.ts", "src/doctor.ts", "src/cli.ts"]
tests_frozen: ["tests/adapters.test.ts", "tests/doctor.test.ts", "tests/helpers/stubs.ts", "tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 450000, minutes: 120 }
---
## Passos
- [x] commit RED: tests/adapters.test.ts, tests/doctor.test.ts, tests/helpers/stubs.ts; prove-red exit 0; PARE
- [x] GREEN: shadow/manifest: alvos de diretório, symlinks, YAML, prefixos só-acréscimo, diff por etapa
- [x] GREEN: adapters pi/hermes/tuios (CLI nativo na sombra), opencode (arquivo próprio); install --only
- [x] GREEN: doctor.ts (probes, finalizeRecord, law2, timeout, manifest, llm); cli ganha `doctor`
- [x] commit GREEN com caminhos explícitos; mise run stable; verify, judge e eval de tasks/T13/PLAN.md

## Dívidas conscientes
- formatos de Hermes enable e TUIOS hooks não verificados (§A.5): stubs fixam o contrato, doctor acusa
- probes casam texto da saída (list/status): mudança de formato do harness vira degraded, não ok
- XDG_CONFIG_HOME fora de ~/.config não suportado no opencode; perfil Hermes só default

## Fora
- agy, pinga adopt, hooks reais do opencode, checkpoint do TUIOS após um turno (v0.2)
