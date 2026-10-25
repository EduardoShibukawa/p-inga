## EVAL T16
executor: opencode/glm-5.3-flash (glm) · planejador: gemini-4-argon (gemini)
auto:   status pass · tentativas 3 · tempo 1 min · tokens in=30574 out=4350 cache=null usd=null
escopo: tests_frozen intacto · fora do touch: nenhum
parecer: T16 fail: juiz qwen2.5-3b-instruct (qwen) reprovou (1 achados)
dono:
  bom: Ingestão multi-harness (pi JSONL, opencode.db, hermes state.db, FRICTION.md) e blocklist I21 de credenciais com 13 testes e holdout verde
  ruim: Juiz 3B local alucinou ausência de frictionFile que está presente em MultiIngestOptions
  mudar: Usar subagente flash-executor (Gemini 3.8 Flash) na T17 para o detector user_correction de alta precisão
