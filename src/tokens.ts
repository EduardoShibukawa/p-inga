import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Receipt } from "./receipt";

export type UsageTotals = {
  in: number;
  out: number;
  cache: number | null;
  cost_usd: number | null;
  lines: number;
};

export type TokenFields = Pick<Receipt, "tokens" | "cost_usd" | "cost_evidence">;

export const NOT_RUN_TOKENS: TokenFields = {
  tokens: { in: null, out: null, cache: null, source: null },
  cost_usd: null,
  cost_evidence: "not run",
};

type UsageParse =
  | { ok: true; totals: UsageTotals }
  | { ok: false; error: string };

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function invalidTokenError(line: number, fields: string): UsageParse {
  return {
    ok: false,
    error: `valor de token inválido na linha ${line} (${fields})`,
  };
}

function invalidCostError(line: number): UsageParse {
  return {
    ok: false,
    error: `valor de custo inválido na linha ${line}`,
  };
}

export function parseUsageJsonl(text: string): UsageParse {
  const lines = text.split(/\r?\n/);
  const seenIds = new Set<string>();

  let totalIn = 0;
  let totalOut = 0;
  let totalCache = 0;
  let totalCost = 0;
  let hasCache = false;
  let hasCost = false;
  let counted = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.trim() === "") continue;

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return { ok: false, error: `JSON inválido na linha ${lineNo}` };
    }

    // a) Claude Code: message.usage com input_tokens/output_tokens
    const cu = obj?.message?.usage;
    if (
      cu !== null &&
      typeof cu === "object" &&
      (cu.input_tokens !== undefined || cu.output_tokens !== undefined)
    ) {
      const msgId = obj.message.id;
      if (typeof msgId === "string") {
        if (seenIds.has(msgId)) continue;
        seenIds.add(msgId);
      }
      if (!isInt(cu.input_tokens) || !isInt(cu.output_tokens)) {
        return invalidTokenError(lineNo, "input_tokens/output_tokens");
      }
      totalIn += cu.input_tokens;
      totalOut += cu.output_tokens;
      counted++;

      if (
        cu.cache_read_input_tokens !== undefined ||
        cu.cache_creation_input_tokens !== undefined
      ) {
        if (
          (cu.cache_read_input_tokens !== undefined &&
            !isInt(cu.cache_read_input_tokens)) ||
          (cu.cache_creation_input_tokens !== undefined &&
            !isInt(cu.cache_creation_input_tokens))
        ) {
          return invalidTokenError(lineNo, "cache input tokens");
        }
        hasCache = true;
        totalCache +=
          (cu.cache_read_input_tokens ?? 0) +
          (cu.cache_creation_input_tokens ?? 0);
      }

      if (obj.costUSD !== undefined && obj.costUSD !== null) {
        if (
          typeof obj.costUSD !== "number" ||
          !Number.isFinite(obj.costUSD) ||
          obj.costUSD < 0
        ) {
          return invalidCostError(lineNo);
        }
        hasCost = true;
        totalCost += obj.costUSD;
      }
      continue;
    }

    // b) pi: message.usage ou usage (raiz), com input/output
    const mu = obj?.message?.usage;
    const ru = obj?.usage;
    let u: unknown = null;
    if (mu !== null && typeof mu === "object" && (mu.input !== undefined || mu.output !== undefined)) {
      u = mu;
    } else if (ru !== null && typeof ru === "object" && (ru.input !== undefined || ru.output !== undefined)) {
      u = ru;
    }
    if (u !== null) {
      const usage = u as any;
      if (!isInt(usage.input) || !isInt(usage.output)) {
        return invalidTokenError(lineNo, "input/output");
      }
      totalIn += usage.input;
      totalOut += usage.output;
      counted++;

      if (usage.cacheRead !== undefined || usage.cacheWrite !== undefined) {
        if (
          (usage.cacheRead !== undefined && !isInt(usage.cacheRead)) ||
          (usage.cacheWrite !== undefined && !isInt(usage.cacheWrite))
        ) {
          return invalidTokenError(lineNo, "cacheRead/cacheWrite");
        }
        hasCache = true;
        totalCache += (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      }

      const costTotal = usage.cost?.total;
      if (costTotal !== undefined && costTotal !== null) {
        if (
          typeof costTotal !== "number" ||
          !Number.isFinite(costTotal) ||
          costTotal < 0
        ) {
          return invalidCostError(lineNo);
        }
        hasCost = true;
        totalCost += costTotal;
      }
      continue;
    }

    // c) opencode/agy: tokens (raiz), com input/output
    const t = obj?.tokens;
    if (t !== null && typeof t === "object" && (t.input !== undefined || t.output !== undefined)) {
      if (!isInt(t.input) || !isInt(t.output)) {
        return invalidTokenError(lineNo, "input/output");
      }
      totalIn += t.input;
      totalOut += t.output;
      counted++;

      if (t.cache !== undefined && t.cache !== null) {
        if (typeof t.cache === "number") {
          if (!isInt(t.cache)) return invalidTokenError(lineNo, "tokens.cache");
          hasCache = true;
          totalCache += t.cache;
        } else if (typeof t.cache === "object") {
          if (
            (t.cache.read !== undefined && !isInt(t.cache.read)) ||
            (t.cache.write !== undefined && !isInt(t.cache.write))
          ) {
            return invalidTokenError(lineNo, "tokens.cache read/write");
          }
          hasCache = true;
          totalCache += (t.cache.read ?? 0) + (t.cache.write ?? 0);
        }
      }

      const c = obj.cost_usd ?? obj.cost;
      if (c !== undefined && c !== null) {
        if (typeof c !== "number" || !Number.isFinite(c) || c < 0) {
          return invalidCostError(lineNo);
        }
        hasCost = true;
        totalCost += c;
      }
      continue;
    }

    // Linha que não casa com nenhum formato: ignorada.
  }

  if (counted === 0) {
    return { ok: false, error: "nenhuma linha de uso encontrada" };
  }

  return {
    ok: true,
    totals: {
      in: totalIn,
      out: totalOut,
      cache: hasCache ? totalCache : null,
      cost_usd: hasCost ? Number(totalCost.toFixed(6)) : null,
      lines: counted,
    },
  };
}

export function resolveUsageFile(
  flag: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (flag !== undefined && flag !== "") return flag;
  const fromEnv = env.PINGA_USAGE_FILE;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return null;
}

function notRunTokenFields(): TokenFields {
  return { tokens: { ...NOT_RUN_TOKENS.tokens }, cost_usd: null, cost_evidence: "not run" };
}

function invalidTokenFields(abs: string, motivo: string): TokenFields {
  return {
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: `invalid:${abs}: ${motivo}`.slice(0, 280),
  };
}

export function tokenFieldsFor(path: string | null): TokenFields {
  if (path === null) return notRunTokenFields();

  const abs = resolve(path);

  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch (err) {
    return invalidTokenFields(abs, (err as Error).message);
  }

  const parsed = parseUsageJsonl(bytes.toString("utf8"));
  if (!parsed.ok) {
    return invalidTokenFields(abs, parsed.error);
  }

  const sha = createHash("sha256").update(bytes).digest("hex");
  return {
    tokens: {
      in: parsed.totals.in,
      out: parsed.totals.out,
      cache: parsed.totals.cache,
      source: "host-structured",
    },
    cost_usd: parsed.totals.cost_usd,
    cost_evidence: `host-structured:${abs}#${sha}`,
  };
}
