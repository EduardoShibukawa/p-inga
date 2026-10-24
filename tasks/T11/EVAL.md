## EVAL T11
executor: opencode/glm-5.3-flash-free (glm) · planejador: claude-opus-5-5 (claude)
auto:   status pass · tentativas 1 · tempo 1 min · tokens in=7428 out=11 cache=null usd=null
escopo: tests_frozen intacto · fora do touch: nenhum
parecer: T11 pass: juiz qwen2.5-3b-instruct (qwen) aprovou
dono:
  bom: Prova de falha no base em git worktree temporária com limpeza garantida mesmo após SIGKILL
  ruim: Repositórios com dependências externas precisarão de cache/artefatos na worktree para não cair em infra
  mudar: Usar prove-red obrigatoriamente no gate do RED a partir da T12 (Fase 3)
