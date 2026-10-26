import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateInertia,
  type InertiaAction,
  type InertiaResult,
} from "./breaker";
import { preflightCheck } from "./typecheck";

export const PAYLOAD_MAX_LINES = 100;
export const PAYLOAD_MAX_CHARS = 1500;
export const NEW_FILE_MAX_LINES = 120;
export const NEW_FILE_MAX_CHARS = 2500;

export type PreToolGuardResult = {
  allowed: boolean;
  reason?: string;
};

export type PostToolTypeCheckResult = {
  ok: boolean;
  diagnostics?: string;
};

export type { InertiaAction, InertiaResult };

export const PAYLOAD_GUARD_REASON =
  "VIOLAÇÃO P-INGÁ (Guardrail G2 - Payload Guard): O arquivo já existe e o payload de escrita excede 100 linhas / 1500 caracteres. Para evitar truncamento de JSON e perda de contexto, use 'gira write <file> <symbol>' para alterar apenas a função alvo, ou 'gira add'.";

export const NEW_FILE_GUARD_REASON =
  "VIOLAÇÃO P-INGÁ (Guardrail G2 - Payload Guard): O arquivo novo excede o limite de criação (120 linhas / 2500 caracteres). Crie apenas o esqueleto inicial com as assinaturas e use 'append_file' ou 'gira add' para preencher as implementações progressivamente.";

const READ_TOOLS = new Set(["read_file", "list_files", "search", "check_syntax"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file", "append_file"]);
const GIRA_READ_ACTIONS = new Set(["outline", "locate", "slice", "read", "impact"]);
const GIRA_WRITE_ACTIONS = new Set(["write", "add"]);

function targetOf(args: Record<string, any>): string | undefined {
  const target = args?.path ?? args?.target;
  return typeof target === "string" && target.length > 0 ? target : undefined;
}

/**
 * Conta linhas de um payload de escrita, ignorando o terminador final.
 * Um conteúdo "a\nb\n" tem 2 linhas; "a\nb" também tem 2 linhas.
 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/).length;
  return content.endsWith("\n") || content.endsWith("\r") ? lines - 1 : lines;
}

/**
 * Guardrail G2 — Guardrail pré-escrita (PreTool Payload Guard).
 * Bloqueia sobrescritas monolíticas em arquivos já existentes, que são a
 * principal causa de truncamento de JSON e perda de contexto em LLMs.
 */
export function preToolPayloadGuard(
  toolName: string,
  args: Record<string, any>,
  cwd?: string
): PreToolGuardResult {
  if (toolName !== "write_file") return { allowed: true };

  const target = targetOf(args);
  if (target === undefined) return { allowed: true };

  const base = cwd ?? process.cwd();
  const fileExists = existsSync(resolve(base, target));

  const content = typeof args?.content === "string" ? args.content : "";
  const lineCount = countLines(content);

  if (fileExists) {
    if (lineCount > PAYLOAD_MAX_LINES || content.length > PAYLOAD_MAX_CHARS) {
      return { allowed: false, reason: PAYLOAD_GUARD_REASON };
    }
  } else {
    if (lineCount > NEW_FILE_MAX_LINES || content.length > NEW_FILE_MAX_CHARS) {
      return { allowed: false, reason: NEW_FILE_GUARD_REASON };
    }
  }

  return { allowed: true };
}

/**
 * Hook pós-escrita: roda o pre-flight estático no arquivo alterado e devolve
 * os diagnósticos para que o agente corrija a sintaxe imediatamente.
 */
export async function postToolTypeCheckHook(
  toolName: string,
  args: Record<string, any>,
  cwd?: string
): Promise<PostToolTypeCheckResult> {
  const isGiraContextWrite =
    toolName === "gira_context" &&
    (GIRA_WRITE_ACTIONS.has(args?.action) || GIRA_WRITE_ACTIONS.has(args?.command));

  if (!WRITE_TOOLS.has(toolName) && !isGiraContextWrite) {
    return { ok: true };
  }

  const target = targetOf(args);
  if (target === undefined) return { ok: true };

  const result = preflightCheck(target, cwd ?? process.cwd());
  if (result.diagnostics) {
    return { ok: false, diagnostics: result.diagnostics };
  }

  return { ok: true };
}

/**
 * Guardrail G1 — Disjuntor de Inércia (Read-Loop Breaker).
 * Classifica a ação atual, anexa ao histórico e avalia o encadeamento de
 * leituras consecutivas sem mutação ou teste.
 */
export function postToolInertiaHook(
  toolName: string,
  args: Record<string, any>,
  history: InertiaAction[],
  success: boolean = true
): InertiaResult {
  const action = args?.action ?? args?.command;
  const target = targetOf(args);

  let type: InertiaAction["type"] | undefined;

  if (READ_TOOLS.has(toolName)) {
    type = "read";
  } else if (WRITE_TOOLS.has(toolName)) {
    type = "write";
  } else if (toolName === "run_tests" || toolName === "run_python") {
    type = "test";
  } else if (toolName === "gira_context") {
    if (GIRA_READ_ACTIONS.has(action)) type = "read";
    else if (GIRA_WRITE_ACTIONS.has(action)) type = "write";
  }

  if (type !== undefined) {
    history.push({
      type,
      ...(target !== undefined ? { target } : {}),
      ...(success === false ? { success: false } : {}),
    });
  }

  return evaluateInertia(history);
}
