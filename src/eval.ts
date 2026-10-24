import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { alwaysAllowed, changedFiles, findRedBase } from "./guards";
import { defaultLedgerPath, openLedger } from "./ledger";
import { parsePlan } from "./plan";
import type { Receipt, Status } from "./receipt";
import { receiptKind } from "./receipt";

export const PLANNER_DEFAULT = { model: "gemini-4-argon", family: "gemini" } as const;

export type Scope = {
  tests_frozen: "intacto" | "ALTERADO" | "sem base";
  out_of_touch: string[] | null; // [] → "nenhum"; null → "sem base"
};

export type OwnerFields = { bom: string; ruim: string; mudar: string };

export type EvalDoc = {
  task: string;
  executor: string; // "<model> (<family>)"
  planner: string; // "<model> (<family>)"
  status: Status;
  attempts: number; // inteiro ≥ 1
  minutes: number; // inteiro ≥ 0
  tokens: string; // "not run" | "in=<n> out=<n> cache=<n|null> usd=<x|null>"
  scope: Scope;
  parecer: string; // não vazio
  dono: OwnerFields; // valores podem ser ""
};

const TOKENS_RE = /^in=\d+ out=\d+ cache=(\d+|null) usd=(\d+(\.\d+)?|null)$/;
const STATUSES: readonly string[] = ["pass", "fail", "blocked", "not run"];

function tokensOk(tokens: string): boolean {
  return tokens === "not run" || TOKENS_RE.test(tokens);
}

function parseOutOfTouch(raw: string): string[] | null {
  if (raw === "sem base") return null;
  if (raw === "nenhum") return [];
  return raw.split(", ").map((s) => s.trim()).filter(Boolean);
}

function validateDoc(
  text: string,
  task?: string,
): { errors: string[]; doc?: EvalDoc } {
  const errors: string[] = [];
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);

  if (lines.length !== 9) {
    errors.push(`número de linhas inválido: ${lines.length} (esperado 9)`);
  }

  const header = lines[0]?.match(/^## EVAL (\S+)$/);
  if (!header) {
    errors.push("linha 1 inválida: esperado '## EVAL <task>'");
  } else if (task !== undefined && header[1] !== task) {
    errors.push(
      `linha 1 inválida: cabeçalho é '${header[1]}', esperado '${task}'`,
    );
  }

  const l1 = lines[1]?.match(
    /^executor: (.+ \(.+\)) · planejador: (.+ \(.+\))$/,
  );
  if (!l1) {
    errors.push(
      "linha 2 inválida: esperado 'executor: <model> (<fam>) · planejador: <model> (<fam>)'",
    );
  }

  const l2 = lines[2]?.match(
    /^auto:\s+status ([a-z ]+) · tentativas (\d+) · tempo (\d+) min · tokens (.+)$/,
  );
  if (!l2) {
    errors.push(
      "linha 3 inválida: esperado 'auto:   status <status> · tentativas <n> · tempo <n> min · tokens <resumo>'",
    );
  } else {
    if (!STATUSES.includes(l2[1])) {
      errors.push(`linha 3 inválida: status desconhecido '${l2[1]}'`);
    }
    if (Number(l2[2]) < 1) {
      errors.push("linha 3 inválida: tentativas deve ser >= 1");
    }
    if (Number(l2[3]) < 0) {
      errors.push("linha 3 inválida: tempo deve ser >= 0");
    }
    if (!tokensOk(l2[4])) {
      errors.push(
        `linha 3 inválida: tokens '${l2[4]}' fora do formato válido`,
      );
    }
  }

  const l3 = lines[3]?.match(
    /^escopo: tests_frozen (intacto|ALTERADO|sem base) · fora do touch: (.+)$/,
  );
  if (!l3) {
    errors.push(
      "linha 4 inválida: esperado 'escopo: tests_frozen <estado> · fora do touch: <lista>'",
    );
  }

  const l4 = lines[4]?.match(/^parecer: (.+)$/);
  if (!l4 || l4[1].trim().length === 0) {
    errors.push("linha 5 inválida: esperado 'parecer: <texto não vazio>'");
  }

  const l5 = lines[5]?.match(/^dono:$/);
  if (!l5) {
    errors.push("linha 6 inválida: esperado 'dono:'");
  }

  const l6 = lines[6]?.match(/^  bom:\s*(.*)$/);
  const l7 = lines[7]?.match(/^  ruim:\s*(.*)$/);
  const l8 = lines[8]?.match(/^  mudar:\s*(.*)$/);
  if (!l6) errors.push("linha 7 inválida: esperado '  bom: <texto>'");
  if (!l7) errors.push("linha 8 inválida: esperado '  ruim: <texto>'");
  if (!l8) errors.push("linha 9 inválida: esperado '  mudar: <texto>'");

  if (errors.length > 0) return { errors };

  const doc: EvalDoc = {
    task: header![1],
    executor: l1![1],
    planner: l1![2],
    status: l2![1] as Status,
    attempts: Number(l2![2]),
    minutes: Number(l2![3]),
    tokens: l2![4],
    scope: {
      tests_frozen: l3![1] as Scope["tests_frozen"],
      out_of_touch: parseOutOfTouch(l3![2]),
    },
    parecer: l4![1],
    dono: {
      bom: l6![1].trim(),
      ruim: l7![1].trim(),
      mudar: l8![1].trim(),
    },
  };
  return { errors, doc };
}

export function renderEval(doc: EvalDoc): string {
  const out = doc.scope.out_of_touch;
  const outStr =
    out === null
      ? "sem base"
      : out.length === 0
        ? "nenhum"
        : [...out].sort().join(", ");
  const lines = [
    `## EVAL ${doc.task}`,
    `executor: ${doc.executor} · planejador: ${doc.planner}`,
    `auto:   status ${doc.status} · tentativas ${doc.attempts} · tempo ${doc.minutes} min · tokens ${doc.tokens}`,
    `escopo: tests_frozen ${doc.scope.tests_frozen} · fora do touch: ${outStr}`,
    `parecer: ${doc.parecer}`,
    "dono:",
    doc.dono.bom ? `  bom:   ${doc.dono.bom}` : "  bom:",
    doc.dono.ruim ? `  ruim:  ${doc.dono.ruim}` : "  ruim:",
    doc.dono.mudar ? `  mudar: ${doc.dono.mudar}` : "  mudar:",
  ];
  return `${lines.join("\n")}\n`;
}

export function parseEval(
  text: string,
): { ok: true; doc: EvalDoc } | { ok: false; errors: string[] } {
  const { errors, doc } = validateDoc(text);
  return errors.length === 0 ? { ok: true, doc: doc! } : { ok: false, errors };
}

export function validateEval(
  text: string,
  task?: string,
): { ok: true } | { ok: false; errors: string[] } {
  const { errors } = validateDoc(text, task);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function extractOwnerFields(
  text: string,
): OwnerFields & { parecer: string | null } {
  let bom = "";
  let ruim = "";
  let mudar = "";
  let parecer: string | null = null;

  for (const line of text.split(/\r?\n/)) {
    const p = line.match(/^parecer:\s*(.*)$/);
    if (p) {
      const value = p[1].trim();
      if (value.length > 0) parecer = value;
      continue;
    }
    const b = line.match(/^\s*bom:\s*(.*)$/);
    if (b) {
      bom = b[1].trim();
      continue;
    }
    const r = line.match(/^\s*ruim:\s*(.*)$/);
    if (r) {
      ruim = r[1].trim();
      continue;
    }
    const m = line.match(/^\s*mudar:\s*(.*)$/);
    if (m) {
      mudar = m[1].trim();
    }
  }

  return { bom, ruim, mudar, parecer };
}

export function summarizeTokens(receipts: Receipt[]): string {
  const measured = receipts.filter((r) => r.tokens.source === "host-structured");
  if (measured.length === 0) return "not run";

  let sumIn = 0;
  let sumOut = 0;
  let sumCache = 0;
  let sumCost = 0;
  let hasCache = false;
  let hasCost = false;

  for (const r of measured) {
    sumIn += r.tokens.in ?? 0;
    sumOut += r.tokens.out ?? 0;
    if (r.tokens.cache !== null) {
      hasCache = true;
      sumCache += r.tokens.cache;
    }
    if (r.cost_usd !== null) {
      hasCost = true;
      sumCost += r.cost_usd;
    }
  }

  const cacheStr = hasCache ? String(sumCache) : "null";
  const usdStr = hasCost ? String(Number(sumCost.toFixed(6))) : "null";
  return `in=${sumIn} out=${sumOut} cache=${cacheStr} usd=${usdStr}`;
}

export function evalPlan(
  planPath: string,
  opts?: { ledgerPath?: string; check?: boolean },
): number {
  const resolvedPlan = resolve(planPath);
  const dir = dirname(resolvedPlan);
  const task = basename(dir);
  const evalPath = join(dir, "EVAL.md");

  if (opts?.check === true) {
    if (!existsSync(evalPath)) {
      console.error("EVAL.md ausente");
      return 1;
    }
    const v = validateEval(readFileSync(evalPath, "utf8"), task);
    if (!v.ok) {
      console.error(v.errors.join("\n"));
      return 1;
    }
    console.log(`ok ${evalPath}`);
    return 0;
  }

  const ledger = openLedger(opts?.ledgerPath ?? defaultLedgerPath());
  let allTaskReceipts: Receipt[];
  try {
    allTaskReceipts = ledger
      .all()
      .filter((row) => row.task === task)
      .map((row) => JSON.parse(row.body) as Receipt);
  } finally {
    ledger.close();
  }

  const verifyReceipts = allTaskReceipts.filter(
    (r) => receiptKind(r) === "verify",
  );
  if (verifyReceipts.length === 0) {
    console.error(`sem recibos para ${task}`);
    return 1;
  }

  const lastVerify = verifyReceipts[verifyReceipts.length - 1]!;
  const status = lastVerify.status;
  const attempts = verifyReceipts.length;
  const totalDurationMs = verifyReceipts.reduce(
    (acc, r) => acc + r.evidence.reduce((a, e) => a + e.duration_ms, 0),
    0,
  );
  const minutes = Math.ceil(totalDurationMs / 60000);
  const tokens = summarizeTokens(allTaskReceipts);

  const execModel = lastVerify.author.model ?? "desconhecido";
  const execFamily = lastVerify.author.family ?? "desconhecida";
  const executor = `${execModel} (${execFamily})`;

  const envModel = process.env.PINGA_PLANNER_MODEL;
  const envFamily = process.env.PINGA_PLANNER_FAMILY;
  const planModel =
    envModel !== undefined && envModel !== "" ? envModel : PLANNER_DEFAULT.model;
  const planFamily =
    envFamily !== undefined && envFamily !== ""
      ? envFamily
      : PLANNER_DEFAULT.family;
  const planner = `${planModel} (${planFamily})`;

  // Escopo ao vivo, contra a base RED da task.
  let scope: Scope = { tests_frozen: "sem base", out_of_touch: null };
  const rootRes = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const repoRoot =
    rootRes.exitCode === 0 ? rootRes.stdout.toString().trim() : dir;
  const parsedPlan = parsePlan(readFileSync(resolvedPlan, "utf8"));
  const base = findRedBase(repoRoot, task);
  if (base !== null) {
    const changed = changedFiles(repoRoot, base);
    const frozenSet = new Set(
      parsedPlan.ok && parsedPlan.plan.tests_frozen
        ? parsedPlan.plan.tests_frozen
        : [],
    );
    const tests_frozen: Scope["tests_frozen"] = changed.some((f) =>
      frozenSet.has(f),
    )
      ? "ALTERADO"
      : "intacto";
    const touchSet = new Set([
      ...(parsedPlan.ok && parsedPlan.plan.touch ? parsedPlan.plan.touch : []),
      ...alwaysAllowed(task),
    ]);
    scope = {
      tests_frozen,
      out_of_touch: changed.filter((f) => !touchSet.has(f)).sort(),
    };
  }

  // Parecer: recibo do juiz tem precedência sobre a regra de família da T07.
  const judgeReceipts = allTaskReceipts.filter(
    (r) => receiptKind(r) === "judge",
  );
  let parecer: string;
  const existing = existsSync(evalPath)
    ? extractOwnerFields(readFileSync(evalPath, "utf8"))
    : { bom: "", ruim: "", mudar: "", parecer: null as string | null };
  if (judgeReceipts.length > 0) {
    parecer = judgeReceipts[judgeReceipts.length - 1]!.summary;
  } else if (lastVerify.author.family !== null && lastVerify.author.family === planFamily) {
    parecer = "n/a: mesma família";
  } else if (existing.parecer && existing.parecer !== "n/a: mesma família") {
    parecer = existing.parecer;
  } else {
    parecer = "pendente";
  }
  const doc: EvalDoc = {
    task,
    executor,
    planner,
    status,
    attempts,
    minutes,
    tokens,
    scope,
    parecer,
    dono: { bom: existing.bom, ruim: existing.ruim, mudar: existing.mudar },
  };

  writeFileSync(evalPath, renderEval(doc), "utf8");
  console.log(evalPath);
  return 0;
}
