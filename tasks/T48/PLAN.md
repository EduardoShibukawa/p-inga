---
mode: mvp
goal: "Probe do opencode confere o plugin gerado no config dir que o opencode reporta, não `plugin list`"
touch:
  - src/adapters/opencode.ts
  - tests/doctor.test.ts
  - tests/helpers/stubs.ts
done_when: "bun test tests/opencode_probe.test.ts tests/doctor.test.ts"
tests_frozen: ["tests/opencode_probe.test.ts"]
---
# T48: probe honesto do opencode

opencode v2.1.4 `plugin list` só mostra plugins com `tui.js`; o plugin do
pi-harness é server-only (OPENCODE_TARGET), então o doctor dava `degraded`
com o plugin presente. O probe passa a rodar `opencode debug paths`, pega a
linha `config` e confere `<config>/plugins/pi-harness.ts` com OPENCODE_HEADER.
