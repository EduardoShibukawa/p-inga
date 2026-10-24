import { MODES, type Mode, type ModeOverride, MODE_RAISED_BY, type ModeRaisedBy } from "./mode";

export const STATUSES = ["pass", "fail", "blocked", "not run"] as const;
export const REASON_CODES = [
  "command_failed",
  "plan_invalid",
  "budget",
  "breaker_same_failure",
  "scope_drift",
  "tests_frozen_changed",
  "same_family_judge",
  "infra",
  "not_executed",
  "judge_rejected",
  "model_unattested",
  "overfit_holdout",
  "test_passed_on_base",
] as const;
export const MAX_RECEIPT_BYTES = 4096;
export const MAX_TEXT = 280;

export type Status = (typeof STATUSES)[number];
export type ReasonCode = (typeof REASON_CODES)[number];

export type ArtifactRef = {
  path: string;
  sha256: string;
};

export type Evidence = {
  kind: "command";
  cmd_sha256: string;
  exit: number | null;
  duration_ms: number;
  artifact_ref: ArtifactRef | null;
};

export type Attestation = {
  claimed: string | null;
  served: string;
  via: "/v1/models" | "transcript";
};

export type Receipt = {
  v: 1;
  type: "task.receipt";
  id: string;
  task: string;
  status: Status;
  reason_code: ReasonCode | null;
  attempts: number;
  evidence: Evidence[];
  tokens: {
    in: number | null;
    out: number | null;
    cache: number | null;
    source: "host-structured" | null;
  };
  cost_usd: number | null;
  cost_evidence: string;
  author: {
    model: string | null;
    family: string | null;
  };
  verified_by: {
    model: string | null;
    family: string | null;
  } | null;
  summary: string;
  created_at: string;
  flow?: string;
  base_ref?: string;
  mode_effective?: Mode;
  mode_raised_by?: ModeRaisedBy;
  mode_override?: ModeOverride;
  breaker?: {
    tripped: boolean;
    failure_signature: string | null;
  };
  checkpoint_ref?: string;
  next_action?: string;
  question?: {
    text: string;
    options: string[];
  };
  model_attested?: Attestation;
};

export function receiptKind(
  r: Pick<Receipt, "flow">,
): "verify" | "judge" | "prove_red" {
  if (r.flow === "prove_red") return "prove_red";
  return r.flow === "judge" ? "judge" : "verify";
}

type Err = (msg: string) => void;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const HEX64 = /^[0-9a-f]{64}$/i;

function checkString(
  x: Record<string, unknown>,
  key: string,
  msg: Err,
  opts: { optional?: boolean; allowedEmpty?: boolean } = {},
): void {
  const v = x[key];
  if (v === undefined) {
    if (!opts.optional) msg(`missing field: ${key}`);
    return;
  }
  if (typeof v !== "string" || (!opts.allowedEmpty && v.length === 0)) {
    msg(`invalid field: ${key} must be a non-empty string`);
  }
}

function checkOptionalString(x: Record<string, unknown>, key: string, msg: Err): void {
  if (x[key] !== undefined) checkString(x, key, msg, { optional: true });
}

function checkAuthorLike(x: unknown, label: string, msg: Err): void {
  if (!isPlainObject(x)) {
    msg(`invalid field: ${label} must be an object`);
    return;
  }
  const allowed = new Set(["model", "family"]);
  for (const key of Object.keys(x)) {
    if (!allowed.has(key)) msg(`unknown field: ${label}.${key}`);
  }
  for (const key of ["model", "family"] as const) {
    const v = x[key];
    if (v === undefined) msg(`missing field: ${label}.${key}`);
    else if (v !== null && typeof v !== "string") {
      msg(`invalid field: ${label}.${key} must be a string or null`);
    }
  }
}

function checkArtifactRef(x: unknown, label: string, msg: Err): boolean {
  if (!isPlainObject(x)) {
    msg(`invalid field: ${label} must be an object`);
    return false;
  }
  let ok = true;
  for (const key of Object.keys(x)) {
    if (key !== "path" && key !== "sha256") {
      msg(`unknown field: ${key}`);
      ok = false;
    }
  }
  if (!("path" in x)) {
    msg(`missing field: ${label}.path`);
    ok = false;
  } else if (typeof x.path !== "string" || x.path.length === 0) {
    msg(`invalid field: ${label}.path must be a non-empty string`);
    ok = false;
  }
  if (!("sha256" in x)) {
    msg(`missing field: ${label}.sha256`);
    ok = false;
  } else if (typeof x.sha256 !== "string" || !HEX64.test(x.sha256)) {
    msg(`invalid field: ${label}.sha256 must be 64 hex chars`);
    ok = false;
  }
  return ok;
}

function checkEvidence(x: unknown, msg: Err): void {
  if (!isPlainObject(x)) {
    msg("invalid field: evidence entries must be objects");
    return;
  }
  const allowed = new Set(["kind", "cmd_sha256", "exit", "duration_ms", "artifact_ref"]);
  for (const key of Object.keys(x)) {
    if (!allowed.has(key)) msg(`unknown field: ${key}`);
  }
  if (!("kind" in x)) {
    msg("missing field: evidence.kind");
  } else if (x.kind !== "command") {
    msg('invalid field: evidence.kind must be "command"');
  }
  if (!("cmd_sha256" in x)) {
    msg("missing field: evidence.cmd_sha256");
  } else if (typeof x.cmd_sha256 !== "string" || !HEX64.test(x.cmd_sha256)) {
    msg("invalid field: evidence.cmd_sha256 must be 64 hex chars");
  }
  if (!("exit" in x)) {
    msg("missing field: evidence.exit");
  } else if (x.exit !== null && !Number.isInteger(x.exit)) {
    msg("invalid field: evidence.exit must be an integer or null");
  }
  if (!("duration_ms" in x)) {
    msg("missing field: evidence.duration_ms");
  } else if (!Number.isInteger(x.duration_ms) || x.duration_ms < 0) {
    msg("invalid field: evidence.duration_ms must be an integer >= 0");
  }
  if (!("artifact_ref" in x)) {
    msg("missing field: evidence.artifact_ref");
  } else if (x.artifact_ref !== null) {
    checkArtifactRef(x.artifact_ref, "evidence.artifact_ref", msg);
  }
}

function checkTokens(x: unknown, msg: Err): void {
  if (!isPlainObject(x)) {
    msg("invalid field: tokens must be an object");
    return;
  }
  const allowed = new Set(["in", "out", "cache", "source"]);
  for (const key of Object.keys(x)) {
    if (!allowed.has(key)) msg(`unknown field: ${key}`);
  }
  if (!("source" in x)) {
    msg("missing field: tokens.source");
    return;
  }
  const source = x.source;
  if (source !== "host-structured" && source !== null) {
    msg('invalid field: tokens.source must be "host-structured" or null');
  }
  const inOutCache = ["in", "out", "cache"] as const;
  if (source === null) {
    // I4: no invented zeros — when source is null every counter must be null.
    for (const key of inOutCache) {
      const v = x[key];
      if (v === undefined) {
        msg(`missing field: tokens.${key}`);
      } else if (v !== null) {
        msg(`invalid field: tokens.${key} must be null when tokens.source is null`);
      }
    }
    return;
  }
  for (const key of inOutCache) {
    const v = x[key];
    if (v === undefined) {
      msg(`missing field: tokens.${key}`);
    } else if (v !== null && (!Number.isInteger(v) || v < 0)) {
      msg(`invalid field: tokens.${key} must be an integer >= 0 or null`);
    }
  }
}

export function validateReceipt(
  x: unknown,
): { ok: true; receipt: Receipt } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const msg: Err = (m) => errors.push(m);

  if (!isPlainObject(x)) {
    errors.push("invalid input: must be a plain object");
  } else {
    // Size limit first, but keep validating so errors accumulate.
    let sizeOk = true;
    try {
      if (Buffer.byteLength(JSON.stringify(x), "utf8") > MAX_RECEIPT_BYTES) {
        errors.push(`invalid input: exceeds ${MAX_RECEIPT_BYTES} bytes`);
        sizeOk = false;
      }
    } catch {
      errors.push("invalid input: not JSON-representable");
      sizeOk = false;
    }

    const allowedRoot = new Set([
      "v",
      "type",
      "id",
      "task",
      "status",
      "reason_code",
      "attempts",
      "evidence",
      "tokens",
      "cost_usd",
      "cost_evidence",
      "author",
      "verified_by",
      "summary",
      "created_at",
      "flow",
      "base_ref",
      "mode_effective",
      "mode_raised_by",
      "mode_override",
      "breaker",
      "checkpoint_ref",
      "next_action",
      "question",
      "model_attested",
    ]);
    for (const key of Object.keys(x)) {
      if (!allowedRoot.has(key)) msg(`unknown field: ${key}`);
    }

    if (!("v" in x)) {
      msg("missing field: v");
    } else if (x.v !== 1) {
      msg("invalid field: v must be 1");
    }

    if (!("type" in x)) {
      msg("missing field: type");
    } else if (x.type !== "task.receipt") {
      msg('invalid field: type must be "task.receipt"');
    }

    for (const key of ["id", "task", "cost_evidence"] as const) {
      checkString(x, key, msg);
    }

    if (!("status" in x)) {
      msg("missing field: status");
    } else if (!STATUSES.includes(x.status as Status)) {
      msg(`invalid field: status must be one of ${STATUSES.join(", ")}`);
    }

    const statusOk =
      "status" in x && STATUSES.includes(x.status as Status);
    if (!("reason_code" in x)) {
      msg("missing field: reason_code");
    } else if (statusOk && x.status === "pass") {
      if (x.reason_code !== null) {
        msg(`invalid field: reason_code must be null when status is "pass"`);
      }
    } else if (
      x.reason_code === undefined ||
      !REASON_CODES.includes(x.reason_code as ReasonCode)
    ) {
      msg("invalid field: reason_code must be one of REASON_CODES when status is not \"pass\"");
    }

    if (!("attempts" in x)) {
      msg("missing field: attempts");
    } else if (!Number.isInteger(x.attempts) || x.attempts < 1) {
      msg("invalid field: attempts must be an integer >= 1");
    }

    if (!("evidence" in x)) {
      msg("missing field: evidence");
    } else if (!Array.isArray(x.evidence)) {
      msg("invalid field: evidence must be an array");
    } else {
      for (const item of x.evidence) {
        checkEvidence(item, msg);
      }
    }

    if (!("tokens" in x)) {
      msg("missing field: tokens");
    } else {
      checkTokens(x.tokens, msg);
    }

    if (!("cost_usd" in x)) {
      msg("missing field: cost_usd");
    } else if (
      x.cost_usd !== null &&
      (typeof x.cost_usd !== "number" ||
        !Number.isFinite(x.cost_usd) ||
        x.cost_usd < 0)
    ) {
      msg("invalid field: cost_usd must be a finite number >= 0 or null");
    }

    if (!("author" in x)) {
      msg("missing field: author");
    } else {
      checkAuthorLike(x.author, "author", msg);
    }

    if (!("verified_by" in x)) {
      msg("missing field: verified_by");
    } else if (x.verified_by !== null) {
      checkAuthorLike(x.verified_by, "verified_by", msg);
    }

    if (!("summary" in x)) {
      msg("missing field: summary");
    } else if (
      typeof x.summary !== "string" ||
      x.summary.length === 0 ||
      x.summary.length > MAX_TEXT
    ) {
      msg(`invalid field: summary must be a string with 1..${MAX_TEXT} chars`);
    }

    if (!("created_at" in x)) {
      msg("missing field: created_at");
    } else if (
      typeof x.created_at !== "string" ||
      Number.isNaN(Date.parse(x.created_at))
    ) {
      msg("invalid field: created_at must be a valid ISO 8601 string");
    }

    if (x.mode_effective !== undefined) {
      if (
        typeof x.mode_effective !== "string" ||
        !MODES.includes(x.mode_effective as Mode)
      ) {
        msg(`invalid field: mode_effective must be one of ${MODES.join(", ")}`);
      }
    }

    if (x.mode_raised_by !== undefined) {
      if (
        typeof x.mode_raised_by !== "string" ||
        !MODE_RAISED_BY.includes(x.mode_raised_by as ModeRaisedBy)
      ) {
        msg(
          `invalid field: mode_raised_by must be one of ${MODE_RAISED_BY.join(", ")}`,
        );
      }
    }

    if (x.mode_override !== undefined) {
      const o = x.mode_override;
      if (!isPlainObject(o)) {
        msg("invalid field: mode_override must be an object");
      } else {
        const allowed = new Set(["from", "to", "reason"]);
        for (const key of Object.keys(o)) {
          if (!allowed.has(key)) msg(`unknown field: mode_override.${key}`);
        }
        if (!("from" in o)) msg("missing field: mode_override.from");
        else if (typeof o.from !== "string" || !MODES.includes(o.from as Mode)) {
          msg(
            `invalid field: mode_override.from must be one of ${MODES.join(", ")}`,
          );
        }
        if (!("to" in o)) msg("missing field: mode_override.to");
        else if (typeof o.to !== "string" || !MODES.includes(o.to as Mode)) {
          msg(
            `invalid field: mode_override.to must be one of ${MODES.join(", ")}`,
          );
        }
        if (!("reason" in o)) msg("missing field: mode_override.reason");
        else if (
          typeof o.reason !== "string" ||
          o.reason.trim().length < 1 ||
          o.reason.length > 280
        ) {
          msg(
            "invalid field: mode_override.reason must be a string with 1..280 chars",
          );
        }
      }
    }

    const raisedIsOverride = x.mode_raised_by === "operator_override";
    const hasOverride = x.mode_override !== undefined;
    if (raisedIsOverride !== hasOverride) {
      msg(
        raisedIsOverride
          ? "invalid field: mode_raised_by operator_override requires mode_override"
          : "invalid field: mode_override requires mode_raised_by operator_override",
      );
    }

    checkOptionalString(x, "flow", msg);
    if (x.base_ref !== undefined) {
      if (
        typeof x.base_ref !== "string" ||
        !/^[0-9a-f]{40}$/.test(x.base_ref)
      ) {
        msg("invalid field: base_ref must be a 40 hex char sha");
      }
    }
    checkOptionalString(x, "checkpoint_ref", msg);
    checkOptionalString(x, "next_action", msg);

    if (x.model_attested !== undefined) {
      const a = x.model_attested;
      if (!isPlainObject(a)) {
        msg("invalid field: model_attested must be an object");
      } else {
        for (const key of Object.keys(a)) {
          if (key !== "claimed" && key !== "served" && key !== "via") {
            msg(`unknown field: model_attested.${key}`);
          }
        }
        if (!("claimed" in a)) {
          msg("missing field: model_attested.claimed");
        } else if (
          a.claimed !== null &&
          (typeof a.claimed !== "string" || a.claimed.length === 0)
        ) {
          msg(
            "invalid field: model_attested.claimed must be a non-empty string or null",
          );
        }
        if (!("served" in a)) {
          msg("missing field: model_attested.served");
        } else if (typeof a.served !== "string" || a.served.length === 0) {
          msg(
            "invalid field: model_attested.served must be a non-empty string",
          );
        }
        if (!("via" in a)) {
          msg("missing field: model_attested.via");
        } else if (a.via !== "/v1/models" && a.via !== "transcript") {
          msg(
            'invalid field: model_attested.via must be "/v1/models" or "transcript"',
          );
        }
      }
    }

    if (x.breaker !== undefined) {
      const b = x.breaker;
      if (!isPlainObject(b)) {
        msg("invalid field: breaker must be an object");
      } else {
        for (const key of Object.keys(b)) {
          if (key !== "tripped" && key !== "failure_signature") {
            msg(`unknown field: breaker.${key}`);
          }
        }
        if (!("tripped" in b)) {
          msg("missing field: breaker.tripped");
        } else if (typeof b.tripped !== "boolean") {
          msg("invalid field: breaker.tripped must be a boolean");
        }
        if (!("failure_signature" in b)) {
          msg("missing field: breaker.failure_signature");
        } else if (
          b.failure_signature !== null &&
          typeof b.failure_signature !== "string"
        ) {
          msg("invalid field: breaker.failure_signature must be a string or null");
        }
      }
    }

    if (x.question !== undefined) {
      const q = x.question;
      if (!isPlainObject(q)) {
        msg("invalid field: question must be an object");
      } else {
        for (const key of Object.keys(q)) {
          if (key !== "text" && key !== "options") {
            msg(`unknown field: question.${key}`);
          }
        }
        if (!("text" in q)) {
          msg("missing field: question.text");
        } else if (
          typeof q.text !== "string" ||
          q.text.length === 0 ||
          q.text.length > MAX_TEXT
        ) {
          msg(`invalid field: question.text must be a string with 1..${MAX_TEXT} chars`);
        }
        if (!("options" in q)) {
          msg("missing field: question.options");
        } else if (
          !Array.isArray(q.options) ||
          !q.options.every((o): o is string => typeof o === "string")
        ) {
          msg("invalid field: question.options must be an array of strings");
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors: [...new Set(errors)] };
  }
  return { ok: true, receipt: x as Receipt };
}
