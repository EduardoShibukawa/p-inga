import { basename, dirname, join } from "node:path";

/** Pasta de um PLAN no formato novo: PLAN-0005, PLAN-0005-pinga-task-e-plan. */
const PLAN_DIR_RE = /^(PLAN-\d+)(?:-|$)/;

/** Arquivo de uma TASK no formato novo: TASK-02.md, TASK-02-task-ref.md. */
const TASK_FILE_RE = /^(TASK-\d+)(?:-|\.|$)/;

/**
 * Resolve a ref de uma task a partir do caminho do seu PLAN/TASK.
 *
 * - Legado `tasks/T61/PLAN.md` → `T61` (nome da pasta, como sempre foi).
 * - Novo `.ginga/plans/PLAN-0005-x/TASK-02-y.md` → `PLAN-0005/TASK-02`.
 */
export function taskRef(planPath: string): string {
  const dir = basename(dirname(planPath));
  const plan = PLAN_DIR_RE.exec(dir)?.[1];
  const task = TASK_FILE_RE.exec(basename(planPath))?.[1];
  return plan && task ? `${plan}/${task}` : dir;
}

/**
 * Pasta de sidecars (lease, baseline, EXEC/EVAL) de uma task.
 *
 * - Legado `tasks/T61/PLAN.md` → `tasks/T61` (como sempre foi).
 * - Novo `.ginga/plans/PLAN-0005-x/TASK-02-y.md` → `.ginga/plans/PLAN-0005-x/.pinga/TASK-02`.
 */
export function taskSidecarDir(planPath: string): string {
  const dir = dirname(planPath);
  const plan = PLAN_DIR_RE.exec(basename(dir))?.[1];
  const task = TASK_FILE_RE.exec(basename(planPath))?.[1];
  return plan && task ? join(dir, ".pinga", task) : dir;
}
