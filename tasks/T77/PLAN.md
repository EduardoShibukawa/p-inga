---
mode: mvp
goal: "Mensagens de hook e o doctor do pinga só citam o gira quando o provider de contexto é o gira"
done_when: "bun test tests/hooks_provider.test.ts tests/hooks.test.ts tests/doctor.test.ts"
touch:
  - src/hooks.ts
  - src/doctor.ts
  - tests/hooks_provider.test.ts
tests_frozen:
  - tests/hooks_provider.test.ts
---

## Contexto
- Provider: `[context].provider` do `.ginga/project.toml` mais próximo subindo de `cwd`, senão `gira` se estiver no PATH, senão `rg`.
- Exportar `contextProvider(cwd?: string, env?: Record<string, string | undefined>): "gira" | "rg"` em `src/hooks.ts` (parse simples: seção `[context]`, linha `provider = "<valor>"`; sem parser TOML).
- `preToolPayloadGuard`: quando a config em `cwd` (ou ancestral) diz `rg`, os motivos (hooks.ts:28,31) não citam gira: payload → dica contém "edite só o símbolo alvo"; arquivo novo → mantém "append_file". Sem config, comportamento atual (PAYLOAD_GUARD_REASON/NEW_FILE_GUARD_REASON) — o default do guard NÃO usa o PATH (mantém gira), só a config troca a dica.
- `checkGiraStatus` (doctor.ts:456-500): gira ausente E provider (via `contextProvider` com dir/env do target) ≠ "gira" → `{ ok: true, message: ... "opcional" }`. Demais ramos iguais.
- Não remover o suporte às tools `gira_context` (hooks.ts:96-140).
