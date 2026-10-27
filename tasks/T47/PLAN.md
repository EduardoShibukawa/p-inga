---
mode: padrao
goal: "`pinga install --rebaseline` aceita o estado atual como sha256_post quando o diff do install é vazio"
touch:
  - src/install.ts
  - src/cli.ts
done_when: "bun test tests/install_rebaseline.test.ts tests/install.test.ts"
tests_frozen: ["tests/install_rebaseline.test.ts"]
---
# T47: rebaseline explícito do manifesto

`doctor` acusa `sha256 divergente` em alvos que outros instaladores (tuios)
reescreveram, mas `install --dry-run` dá diff vazio e `--apply` com diff vazio
não toca o manifesto (I16). Novo modo `--rebaseline`: exige `--dry-run` prévio
com diff vazio (mesmo plano), não escreve em alvo nenhum e só atualiza
`sha256_post` das entradas cujo alvo existe. Diff não vazio → recusa (usage).
I16 preservado: manifesto só muda por ação explícita do dono.
