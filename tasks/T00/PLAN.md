---
mode: padrao
goal: "Esqueleto do repo p-inga: Bun fixado via mise, bun test, pre-commit com hk e um .gitignore testado que mantém dados brutos fora do git."
done_when: "bun test tests/repo.test.ts"
touch: ["package.json", "tsconfig.json", "mise.toml", "hk.pkl", ".gitignore", "README.md", "testdata/.keep"]
tests_frozen: ["tests/repo.test.ts"]
budget: { tokens: 150000, minutes: 30 }
---
## Passos
- [ ] `git init -b main` em p-inga/ (sem remote: o dono cria o GitHub)
- [ ] commit docs: specs/ e tasks/ como já estão
- [ ] commit RED: só tests/repo.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: arquivos do touch até o done_when passar
- [ ] commit GREEN com caminhos explícitos; preencher EVAL.md

## Dívidas conscientes
- sem CI, como o pi-harness

## Fora
- nada em src/ nem bin/
- nenhuma dependência npm
