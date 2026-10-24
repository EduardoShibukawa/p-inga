## EVAL T10
executor: opencode/glm-5.3-flash-free (glm) · planejador: claude-opus-5-5 (claude)
auto:   status pass · tentativas 1 · tempo 1 min · tokens in=6552 out=22 cache=null usd=null
escopo: tests_frozen intacto · fora do touch: nenhum
parecer: T10 fail: juiz qwen2.5-3b-instruct (qwen) reprovou (1 achados)
dono:
  bom: Partição determinística por sha256 e holdout cego (exit 9 em overfit) com 100% da suíte verde
  ruim: Falso negativo do juiz local 3B (qwen2.5-3b-instruct) em diff de 22KB alegando ausência de runHoldout
  mudar: Calibrar prompt/contexto do juiz local na v0.2 para diffs acima de 15KB
