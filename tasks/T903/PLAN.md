---
mode: mvp
goal: "pinga ledger list --json: lista os receipts mais novos do ledger (seq, task, status, flow, repo, modelo, quando, hash) com o estado da cadeia, para a tela Ledger da Roda Web ler por [commands].ledger"
done_when: "bun test tests/ledger_list_cli.test.ts"
touch:
  - src/cli.ts
  - tests/ledger_list_cli.test.ts
  - tasks/T903/PLAN.md
tests_frozen:
  - tests/ledger_list_cli.test.ts
---

## Contexto
- A tela "Ledger e Bench" do protótipo mostra a cadeia e a tabela de receipts.
- O pinga só tinha `ledger verify`; ninguém de fora lê o ledger sem abrir o SQLite.
- Saída: uma linha JSON `{chain, total, rows}`; `rows` do mais novo para o mais antigo.
- `--limit N` (padrão 50) corta a lista; `total` continua sendo o tamanho da cadeia.
- `repo` é o nome da pasta do repositório (o receipt guarda o caminho do `.git`).
- Só leitura: não escreve no ledger.
