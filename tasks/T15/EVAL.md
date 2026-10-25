## EVAL T15
executor: opencode/glm-5.3-flash (glm) · planejador: claude-opus-5-5 (claude)
auto:   status pass · tentativas 1 · tempo 1 min · tokens in=3817 out=75 cache=null usd=null
escopo: tests_frozen intacto · fora do touch: nenhum
parecer: T15 fail: juiz qwen2.5-3b-instruct (qwen) reprovou (4 achados)
dono:
  bom: 5 detectores SQL determinísticos, aborto I10 estrito sem rede no propose e promote auditável
  ruim: Precisão na amostra de 30 e replay no bench: not run; AC-G atual: 16 tasks pass (3 pass + 4 fail judge com tokens_in)
  mudar: Passar PINGA_USAGE_FILE do executor nas próximas tasks reais até atingir >= 20 no gate da v0.1
