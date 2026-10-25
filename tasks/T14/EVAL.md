## EVAL T14
executor: opencode/glm-5.3-flash (glm) · planejador: claude-opus-5-5 (claude)
auto:   status pass · tentativas 1 · tempo 1 min · tokens in=3765 out=71 cache=null usd=null
escopo: tests_frozen intacto · fora do touch: nenhum
parecer: T14 fail: juiz qwen2.5-3b-instruct (qwen) reprovou (4 achados)
dono:
  bom: Scanner de segredos em 3 camadas + canário pré-ingestão (exit 15) e learn.db idempotente com 299 asserções
  ruim: Corte de diff em 12KB para o juiz 3B em CPU ocultou parte de src/transcript.ts no parecer
  mudar: Usar o learn.db populado na T14 como base dos 5 detectores determinísticos na T15
