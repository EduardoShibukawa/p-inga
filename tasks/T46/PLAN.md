---
mode: mvp
goal: "Adapter tuios declara como alvos as skills e plugins que `tuios install` escreve"
touch:
  - src/adapters/tuios.ts
done_when: "bun test tests/tuios_targets.test.ts tests/adapters.test.ts"
tests_frozen: ["tests/tuios_targets.test.ts"]
---
# T46: alvos do tuios

`pinga install --dry-run` sai 11 com `fora dos alvos:` para .agents/skills/tuios,
.claude/skills/tuios, .config/opencode/plugins/tuios-agent-state(.js) e
.hermes/plugins/tuios-agent-state — tudo escrito pelo próprio `tuios install`.
Declara esses caminhos em `tuiosAdapter.targets`.
