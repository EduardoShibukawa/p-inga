# SPEC 0007 — P-Ingá v0.5 (Context Compactor & Proteção de Context Window)

- status: draft (aprovado para implementação)
- data: 2026-10-25
- escopo: `src/compact.ts`, `src/cli.ts`, `tests/compact.test.ts`
- tarefa: T22

---

## 1. Contexto & Problema
Modelos locais compactos (ex: 4B ou 7B executados via `llama-server`, `hermes` ou `opencode`) possuem limites estritos de contexto (típicos de 16k a 32k tokens).
Em tarefas reais com arquivos volumosos (ex: 1000+ linhas), leituras repetidas de ferramentas rapidamente acumulam dezenas de milhares de caracteres, gerando erros fatais `HTTP 400 Context Length Exceeded`.

Modelos como Claude e Cursor resolvem isso através de poda e compactação de saídas antigas de ferramentas. O P-Ingá, como harness de governança, deve fornecer esse mecanismo nativamente para todos os executores e runners locais do homelab.

---

## 2. Decisões Arquiteturais

### D35 — Módulo Canônico `src/compact.ts`
Implementar função pura e determinística:
```typescript
export interface ContextMessage {
  role: string;
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  [key: string]: any;
}

export interface CompactOptions {
  maxChars?: number;           // Padrão: 40000 chars (~10k-12k tokens)
  keepRecentMessages?: number; // Padrão: 6 (últimos 2-3 turnos intactos)
  maxObservationChars?: number;// Padrão: 300 chars para ferramentas antigas
}

export function compactContext(
  messages: ContextMessage[],
  opts?: CompactOptions
): { messages: ContextMessage[]; compacted: boolean; charsSaved: number }
```

Regras de Poda:
1. **Preservação de Cabeçalho:** As mensagens de sistema (`role: "system"`) e o primeiro prompt do usuário (`role: "user"`) NUNCA sofrem poda de conteúdo.
2. **Preservação de Cauda:** As últimas `keepRecentMessages` mensagens (padrão 6) são mantidas 100% intactas para preservar o raciocínio imediato do modelo.
3. **Poda de Observações Intermediárias:** Para mensagens intermediárias com `role: "tool"`, se o conteúdo exceder `maxObservationChars`, ele é podado para o prefixo e anotado com:
   `\n... [p-inga: trimmed ${trimmedChars} chars of older observation to protect context window]`
4. **Respeito ao Limite Total:** Se o total de caracteres de todas as mensagens for menor ou igual a `maxChars`, nenhuma poda é aplicada (`compacted: false, charsSaved: 0`).

### D36 — Subcomando CLI `pinga compact`
Adicionar em `src/cli.ts`:
`pinga compact <transcript.json> [--max-chars <n>] [--out <file>]`
- Lê o arquivo de transcript / mensagens.
- Executa `compactContext`.
- Emite JSON no stdout ou salva em `--out`.
