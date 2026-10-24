/**
 * Canonical JSON serialization: compact output, object keys sorted
 * lexicographically (recursively), array order preserved, and object keys
 * whose value is `undefined` omitted (same as JSON.stringify).
 */
export function canonicalJson(x: unknown): string {
  if (Array.isArray(x)) {
    const items = x.map((v) => (v === undefined ? "null" : canonicalJson(v)));
    return `[${items.join(",")}]`;
  }

  if (x !== null && typeof x === "object") {
    const obj = x as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      const value = obj[key];
      if (value === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(value)}`);
    }
    return `{${parts.join(",")}}`;
  }

  const out = JSON.stringify(x);
  return out === undefined ? "null" : out;
}
