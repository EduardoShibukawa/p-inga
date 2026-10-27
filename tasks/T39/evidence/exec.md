# T39 — evidência de execução (CLI e docs: T1–T3, D1–D5)

Worktree: `/home/shibuka/Projetos/duh-homelab/p-inga-ux`. Sem commit.
Toolchain: `/home/shibuka/.local/share/mise/installs/bun/1.4.4/bin/bun`.

## 1. RED — teste escrito antes da implementação

`tests/ux_t39_cli_docs.test.ts` rodou antes de qualquer mudança em `src/cli.ts` e docs.
Trecho literal (22 falhas em 27):

```text
400 |     expect(read("docs/intro.md")).toContain("(./guides/quickstart.html)");
                                        ^
error: expect(received).toContain(expected)

Expected to contain: "(./guides/quickstart.html)"
Received: "---\ntitle: Introduction to P-Ingá\n..." (conteúdo do intro antigo, com o nó DISCORD e o link sem "./")
```

```text
(fail) T39 · T1 docs eval recusa diretório sem stack trace > diretório com markdown vira erro de uso em uma linha [46.33ms]
(fail) T39 · T1 docs eval recusa diretório sem stack trace > diretório vazio recebe o mesmo erro de uso [73.73ms]
(fail) T39 · T2 comando inválido imprime token e uso curto > token rejeitado aparece e o USAGE inteiro não é despejado [47.79ms]
(fail) T39 · T2 comando inválido imprime token e uso curto > erro de digitação sugere o comando próximo [62.78ms]
(fail) T39 · T3 pinga web sobe o painel e está no usage > usage documenta pinga web [0.99ms]
(fail) T39 · T3 pinga web sobe o painel e está no usage > package.json expõe o script web [0.17ms]

 5 pass
 22 fail
 36 expect() calls
Ran 27 tests across 1 file. [611.00ms]
```

Exit code: `1`.

## 2. GREEN — done_when

```text
$ bun test tests/ux_t39_cli_docs.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t39_cli_docs.test.ts:
(pass) T39 · T1 docs eval recusa diretório sem stack trace > diretório com markdown vira erro de uso em uma linha [29.15ms]
(pass) T39 · T1 docs eval recusa diretório sem stack trace > diretório vazio recebe o mesmo erro de uso [28.88ms]
(pass) T39 · T1 docs eval recusa diretório sem stack trace > arquivo inexistente continua sendo erro de uma linha [27.85ms]
(pass) T39 · T2 comando inválido imprime token e uso curto > token rejeitado aparece e o USAGE inteiro não é despejado [29.02ms]
(pass) T39 · T2 comando inválido imprime token e uso curto > erro de digitação sugere o comando próximo [27.65ms]
(pass) T39 · T2 comando inválido imprime token e uso curto > comando válido sem alvo ainda mostra o usage completo [29.80ms]
(pass) T39 · T3 pinga web sobe o painel e está no usage > porta padrão do painel é 4242 [0.18ms]
(pass) T39 · T3 pinga web sobe o painel e está no usage > usage documenta pinga web [0.14ms]
(pass) T39 · T3 pinga web sobe o painel e está no usage > package.json expõe o script web [0.07ms]
(pass) T39 · T3 pinga web sobe o painel e está no usage > README e quickstart ensinam o comando [0.05ms]
(pass) T39 · T3 pinga web sobe o painel e está no usage > pinga web sobe o painel e anuncia a URL [30.91ms]
(pass) T39 · D1 onboarding usa caminho que existe > nenhum doc ativo cita o binário fantasma .pinga/pinga-stable [0.16ms]
(pass) T39 · D1 onboarding usa caminho que existe > todo comando bun dos docs aponta para um arquivo existente [0.37ms]
(pass) T39 · D1 onboarding usa caminho que existe > quickstart usa os comandos reais da CLI [0.08ms]
(pass) T39 · D1 onboarding usa caminho que existe > o comando de verificação do quickstart executa de verdade [51.69ms]
(pass) T39 · D2 discord sai do caminho ativo > apêndice existe e guarda I20 e o nó do fluxo [0.14ms]
(pass) T39 · D2 discord sai do caminho ativo > nenhum doc ativo menciona discord [0.17ms]
(pass) T39 · D2 discord sai do caminho ativo > diagrama canônico do intro não promete notificação [0.08ms]
(pass) T39 · D3 modos da doc vêm de src/mode.ts > a linha de modos lista exatamente MODES [0.29ms]
(pass) T39 · D3 modos da doc vêm de src/mode.ts > modos antigos não aparecem mais na doc de invariantes [0.06ms]
(pass) T39 · D4 README descreve o estado atual > versão citada bate com package.json [0.08ms]
(pass) T39 · D4 README descreve o estado atual > todo caminho em crase do README existe [0.15ms]
(pass) T39 · D4 README descreve o estado atual > README delega o detalhe para docs/ [0.05ms]
(pass) T39 · D4 README descreve o estado atual > todo comando bun do README executa [45.57ms]
(pass) T39 · D5 checador de links internos > todos os links internos de docs/ resolvem [28.90ms]
(pass) T39 · D5 checador de links internos > link morto falha nomeando arquivo e linha [30.60ms]
(pass) T39 · D5 checador de links internos > link do intro está normalizado [0.10ms]

 27 pass
 0 fail
 93 expect() calls
Ran 27 tests across 1 file. [380.00ms]
```

Exit code: `0`.

## 3. Gate de cobertura preservado

```text
$ bun test tests/ux_t36_gate.test.ts
bun test v1.4.4 (38afee6c8)

tests/ux_t36_gate.test.ts:
(pass) T36 · gate adversarial da spec 0008 > spec aprovada e todo achado com veredito no gate.md [0.80ms]
(pass) T36 · gate adversarial da spec 0008 > tasks de execucao declaram cobertura disjunta e completa [0.52ms]
(pass) T36 · gate adversarial da spec 0008 > done_when existe e nenhum touch aponta para arquivo de codigo fantasma [0.33ms]

 3 pass
 0 fail
 83 expect() calls
Ran 3 tests across 1 file. [7.00ms]
```

Exit code: `0`.

## 4. Arquivos tocados

Código:
- `src/cli.ts` — `docs eval` recusa diretório com erro de uma linha (sem stack trace);
  `docs links [DIR]` novo (mapeia `.html` → `.md` no docsite, link morto imprime
  `arquivo:linha: alvo` e sai 1); `web [--port N]` novo (import tardio de `web/server`,
  SIGINT/SIGTERM encerram limpo); comando desconhecido imprime o token + sugestão por
  distância de edição em vez de despejar o `USAGE` inteiro; `USAGE` documenta `docs links`
  e `web`.
- `package.json` — script `web`.

Docs:
- `README.md` — reescrito para o estado atual (versão `0.1.0`, comandos que existem,
  `bun bin/pinga.ts web`, delegação do detalhe para `docs/`).
- `docs/guides/quickstart.md` — `.pinga/pinga-stable` (binário fantasma) trocado por
  `bun bin/pinga.ts ...`; novo "Step 4: Abrir o painel".
- `docs/concepts/ledger.md` — mesmo path fantasma corrigido.
- `docs/concepts/invariants.md` — I12 com os modos reais (`mvp`, `padrao`, `completo`);
  I20 reescrita como "Observabilidade Isolada".
- `docs/intro.md` — nó `DISCORD` removido do diagrama; link normalizado para
  `./guides/quickstart.html`.
- `docs/appendix/discord.md` — criado; guarda I20/DISCORD históricos como fora de escopo.

Teste:
- `tests/ux_t39_cli_docs.test.ts` — criado (27 testes).

## 5. Notas e limites (honestidade)

- `docs/SYSTEM_INTEGRATION_SPEC.md` ainda menciona Discord. Ele **não está** na lista
  `touch` de T39, então não foi alterado nem movido; por isso o teste do D2 cobre
  exatamente os docs ativos do escopo (`README.md`, `docs/intro.md`,
  `docs/guides/quickstart.md`, `docs/concepts/ledger.md`, `docs/concepts/invariants.md`).
  Fechar o resto exige autorização para editar/mover aquele spec.
- D1 executa `ledger verify` de verdade em ledger temporário; nada escreve no repo.
- `spawnSync` invoca `bin/pinga.ts` com `process.execPath` (bun 1.4.4) e timeout de 120s.
