export type Plan = {
  mode: "mvp" | "padrao" | "completo";
  goal: string;
  done_when: string;
  touch?: string[];
  tests_frozen?: string[];
  budget?: { tokens?: number; minutes?: number };
};

export type PlanParseResult =
  | { ok: true; plan: Plan }
  | { ok: false; errors: string[] };

const MODES = ["mvp", "padrao", "completo"] as const;
const MAX_LINES = 25;
const MAX_GOAL = 280;

function isStringArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0)
  );
}

export function parsePlan(text: string): PlanParseResult {
  const errors: string[] = [];
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);

  if (lines.length > MAX_LINES) {
    errors.push(`plan exceeds ${MAX_LINES} lines`);
  }

  if (lines[0] !== "---") {
    errors.push("plan must start with '---' frontmatter delimiter");
    return { ok: false, errors };
  }

  const closeIndex = lines.indexOf("---", 1);
  if (closeIndex === -1) {
    errors.push("frontmatter must be closed by a '---' line");
    return { ok: false, errors };
  }

  const frontmatterText = lines.slice(1, closeIndex).join("\n");

  let data: unknown;
  try {
    data = Bun.YAML.parse(frontmatterText);
  } catch (err) {
    errors.push(`invalid frontmatter YAML: ${(err as Error).message}`);
    return { ok: false, errors };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    errors.push("frontmatter must be a mapping");
    return { ok: false, errors };
  }

  const d = data as Record<string, unknown>;

  if (d.mode === undefined) {
    errors.push("missing field: mode");
  } else if (
    typeof d.mode !== "string" ||
    !(MODES as readonly string[]).includes(d.mode)
  ) {
    errors.push(`invalid field: mode must be one of ${MODES.join(", ")}`);
  }

  if (d.goal === undefined) {
    errors.push("missing field: goal");
  } else if (
    typeof d.goal !== "string" ||
    d.goal.length === 0 ||
    d.goal.length > MAX_GOAL
  ) {
    errors.push(
      `invalid field: goal must be a string with 1..${MAX_GOAL} chars`,
    );
  }

  if (d.done_when === undefined) {
    errors.push("missing field: done_when");
  } else if (
    typeof d.done_when !== "string" ||
    d.done_when.trim().length === 0
  ) {
    errors.push("invalid field: done_when must be a non-empty string");
  }

  if (d.touch === undefined) {
    if (d.mode === "padrao" || d.mode === "completo") {
      errors.push("missing field: touch is required in padrao/completo");
    }
  } else if (!isStringArray(d.touch)) {
    errors.push("invalid field: touch must be an array of non-empty strings");
  }

  if (d.tests_frozen !== undefined && !isStringArray(d.tests_frozen)) {
    errors.push(
      "invalid field: tests_frozen must be an array of non-empty strings",
    );
  }

  if (d.budget !== undefined) {
    const b = d.budget;
    if (typeof b !== "object" || b === null || Array.isArray(b)) {
      errors.push("invalid field: budget must be an object");
    } else {
      const budget = b as Record<string, unknown>;
      if (budget.tokens !== undefined) {
        const t = budget.tokens;
        if (!Number.isInteger(t) || t <= 0) {
          errors.push("invalid field: budget.tokens must be an integer > 0");
        }
      }
      if (budget.minutes !== undefined) {
        const m = budget.minutes;
        if (typeof m !== "number" || !Number.isFinite(m) || m <= 0) {
          errors.push("invalid field: budget.minutes must be a number > 0");
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    plan: {
      mode: d.mode as Plan["mode"],
      goal: d.goal as string,
      done_when: d.done_when as string,
      ...(d.touch !== undefined && { touch: d.touch as string[] }),
      ...(d.tests_frozen !== undefined && {
        tests_frozen: d.tests_frozen as string[],
      }),
      ...(d.budget !== undefined && { budget: d.budget as Plan["budget"] }),
    },
  };
}
