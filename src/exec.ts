import { accessSync, constants as fsConstants } from "node:fs";

/**
 * T71: exit próprio quando o sandbox (ex.: bwrap) se declara indisponível.
 * O done_when sob sandbox que morre com este exit não provou pass nem fail.
 */
export const WRAPPER_UNAVAILABLE_EXIT = 97;

/**
 * T71 (PLAN-0018, INTENT-0006 opção A): argv do done_when. Sem
 * `PINGA_EXEC_WRAPPER` (ou vazio) roda `sh -c <cmd>` nu; com ele, o sandbox
 * entra na frente — o 1º argumento do wrapper é a raiz onde o comando roda
 * (o repo alvo, ou no prove, o worktree do base):
 * `[<wrapper>, <root>, "sh", "-c", <cmd>]`.
 */
export function doneWhenArgv(
  cmd: string,
  root: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const wrapper = env["PINGA_EXEC_WRAPPER"];
  if (typeof wrapper === "string" && wrapper.length > 0) {
    return [wrapper, root, "sh", "-c", cmd];
  }
  return ["sh", "-c", cmd];
}

/**
 * Fail-closed: wrapper configurado mas inexistente ou não executável nunca
 * cai para execução nua — o chamador não roda coisa alguma. Retorna o
 * problema (mensagem para o operador, menciona `PINGA_EXEC_WRAPPER`) quando
 * o wrapper está inutilizável; `null` quando não há wrapper configurado
 * ou quando ele está utilizável.
 */
export function wrapperProblem(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const wrapper = env["PINGA_EXEC_WRAPPER"];
  if (wrapper === undefined || wrapper.length === 0) return null;
  try {
    accessSync(wrapper, fsConstants.X_OK);
    return null;
  } catch {
    return `PINGA_EXEC_WRAPPER=${wrapper} inexistente ou não executável`;
  }
}
