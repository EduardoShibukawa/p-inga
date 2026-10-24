import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative as pathRelative,
  resolve,
  sep,
} from "node:path";
import { canonicalJson } from "./canonical";
import { parsePlan } from "./plan";

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export const OVERFIT_EXIT = 9;
export const GENERATED_HEADER = "// gerado por pinga examples (T10): não editar";

export type Example = { name: string; input: unknown[]; output: unknown };

export type ExamplesSpec = {
  target: { module: string; export: string }; // module relativo à raiz do repo
  holdout: number; // já resolvido (default aplicado)
  seed: string; // default ""
  examples: Example[]; // names já resolvidos, na ordem original
};

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const EXPORT_NAME_RE = /^[A-Za-z_$][\w$]*$/;
// Durações impressas pelo bun test (ex.: [0.19ms], [3.00ms], [1.2s]) que
// variam de run para run; removidas antes de tirar o sha do artefato do
// holdout, para que a assinatura do disjuntor seja estável entre rodadas
// idênticas. O resto da saída (diffs de expect, caminhos, contagens) é
// determinístico.
const BUN_DURATION = /\[[0-9]+(?:\.[0-9]+)?(?:ms|us|s)\]/g;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function normalizeBunTestOutput(b: Uint8Array | string): Buffer {
  const raw: string = typeof b === "string" ? b : b.toString("utf8");
  return Buffer.from(raw.replace(BUN_DURATION, "").replace(ANSI, ""), "utf8");
}

function relImportPath(fromDir: string, toFile: string): string {
  let rel = pathRelative(fromDir, toFile).split(sep).join("/");
  if (!rel.startsWith("./") && !rel.startsWith("../")) {
    rel = `./${rel}`;
  }
  return rel;
}

export function parseExamples(
  text: string,
  format: "json" | "yaml",
): { ok: true; spec: ExamplesSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = format === "yaml" ? Bun.YAML.parse(text) : JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`parse error: ${(err as Error).message}`] };
  }

  if (!isPlainObject(data)) {
    return {
      ok: false,
      errors: ["invalid input: raiz deve ser um objeto"],
    };
  }

  const allowedRoot = new Set(["target", "examples", "holdout", "seed"]);
  for (const key of Object.keys(data)) {
    if (!allowedRoot.has(key)) errors.push(`unknown field: ${key}`);
  }

  // target
  let target: { module: string; export: string } | null = null;
  if (data.target === undefined || !isPlainObject(data.target)) {
    errors.push("missing/invalid field: target must be an object");
  } else {
    const t = data.target;
    const allowedTarget = new Set(["module", "export"]);
    for (const key of Object.keys(t)) {
      if (!allowedTarget.has(key)) errors.push(`unknown field: target.${key}`);
    }
    if (typeof t.module !== "string" || t.module.length === 0) {
      errors.push("invalid field: target.module must be a non-empty string");
    } else if (
      t.module.startsWith("/") ||
      t.module.split("/").includes("..") ||
      !(t.module.endsWith(".ts") || t.module.endsWith(".js"))
    ) {
      errors.push(
        'invalid field: target.module must be a relative path ending in .ts or .js',
      );
    }
    if (
      typeof t.export !== "string" ||
      !(EXPORT_NAME_RE.test(t.export) && t.export.length > 0)
    ) {
      errors.push("invalid field: target.export must match ^[A-Za-z_$][\\w$]*$");
    }
    if (
      typeof t.module === "string" &&
      t.module.length > 0 &&
      typeof t.export === "string" &&
      EXPORT_NAME_RE.test(t.export)
    ) {
      target = { module: t.module, export: t.export };
    }
  }

  // seed
  if (data.seed !== undefined && typeof data.seed !== "string") {
    errors.push("invalid field: seed must be a string");
  }
  const seed = typeof data.seed === "string" ? data.seed : "";

  // examples
  let parsedItems: Array<{ name?: unknown; input?: unknown; output?: unknown }> | null = null;
  if (!Array.isArray(data.examples)) {
    errors.push("missing/invalid field: examples must be an array");
  } else if (data.examples.length < 2) {
    errors.push("invalid field: examples must have at least 2 items");
  } else {
    parsedItems = data.examples as Array<{
      name?: unknown;
      input?: unknown;
      output?: unknown;
    }>;
  }

  const seenNames = new Set<string>();
  const seenInputs = new Map<string, number>();
  let examples: Example[] = [];
  if (parsedItems !== null) {
    examples = [];
    parsedItems.forEach((item, i) => {
      if (!isPlainObject(item)) {
        errors.push(`invalid field: examples[${i}] must be an object`);
        return;
      }
      for (const key of Object.keys(item)) {
        if (key !== "input" && key !== "output" && key !== "name") {
          errors.push(`unknown field: examples[${i}].${key}`);
        }
      }
      if (!Array.isArray(item.input)) {
        errors.push(`invalid field: examples[${i}].input must be an array`);
      }
      if (!("output" in item) || item.output === undefined) {
        errors.push(`missing field: examples[${i}].output`);
      }

      let name: string;
      if (item.name === undefined) {
        name = `ex-${i + 1}`;
      } else if (
        typeof item.name !== "string" ||
        item.name.trim().length < 1 ||
        item.name.trim().length > 80
      ) {
        errors.push(
          `invalid field: examples[${i}].name must be a string with 1..80 chars`,
        );
        return;
      } else {
        name = item.name;
      }
      if (seenNames.has(name)) {
        errors.push(`nome repetido: ${name}`);
      } else {
        seenNames.add(name);
      }

      const inputKey = canonicalJson(item.input);
      if (seenInputs.has(inputKey)) {
        errors.push(`input repetido: ${inputKey} (ex-${seenInputs.get(inputKey)! + 1} e ex-${i + 1})`);
      } else {
        seenInputs.set(inputKey, i);
      }

      examples.push({
        name,
        input: item.input as unknown[],
        output: item.output,
      });
    });

    // Toda validação tem que passar para entregar a spec.
    if (errors.length > 0) examples = [];
  }

  // holdout
  const n = parsedItems !== null ? parsedItems.length : 0;
  let holdout: number;
  if (data.holdout === undefined) {
    holdout = Math.max(1, Math.floor(n / 5));
  } else if (!Number.isInteger(data.holdout)) {
    errors.push("invalid field: holdout must be an integer");
    holdout = 0;
  } else if (
    n >= 2 &&
    (data.holdout < 0 || data.holdout > n - 1)
  ) {
    errors.push(`invalid field: holdout must be between 0 and ${n - 1}`);
    holdout = 0;
  } else {
    holdout = data.holdout as number;
  }

  if (errors.length > 0 || target === null) {
    return { ok: false, errors };
  }

  return { ok: true, spec: { target, holdout, seed, examples } };
}

export function exampleKey(task: string, seed: string, e: Example): string {
  return sha256hex(`${task}\n${seed}\n${canonicalJson(e)}`);
}

export function partitionExamples(
  spec: ExamplesSpec,
  task: string,
): { visible: Example[]; holdout: Example[] } {
  const indices = spec.examples.map((_, i) => i);
  indices.sort((a, b) => {
    const ka = exampleKey(task, spec.seed, spec.examples[a]!);
    const kb = exampleKey(task, spec.seed, spec.examples[b]!);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const holdoutIdx = new Set(indices.slice(0, spec.holdout));
  const visible: Example[] = [];
  const holdout: Example[] = [];
  spec.examples.forEach((e, i) => {
    if (holdoutIdx.has(i)) holdout.push(e);
    else visible.push(e);
  });
  return { visible, holdout };
}

export function renderExamplesTest(input: {
  task: string;
  set: "visible" | "holdout";
  importPath: string;
  exportName: string;
  examples: Example[];
}): string {
  const lines: string[] = [];
  lines.push(GENERATED_HEADER);
  lines.push(
    `// task ${input.task} · conjunto ${input.set} · ${input.examples.length} exemplos · sha256 ${sha256hex(canonicalJson(input.examples))}`,
  );
  lines.push(`import { expect, test } from "bun:test";`);
  lines.push(
    `import { ${input.exportName} } from ${JSON.stringify(input.importPath)};`,
  );
  lines.push("");
  for (const ex of input.examples) {
    lines.push(
      `test(${JSON.stringify(ex.name)}, async () => { const args = ${canonicalJson(ex.input)} as unknown[]; expect(await (${input.exportName} as (...a: unknown[]) => unknown)(...args)).toEqual(${canonicalJson(ex.output)}); });`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function visibleTestPath(task: string): string {
  return `tests/examples/${task}.test.ts`;
}

export function holdoutRunnerPath(task: string): string {
  return `.pinga/holdout-run/${task}.test.ts`;
}

export function holdoutDir(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.PINGA_HOLDOUT_DIR !== undefined && env.PINGA_HOLDOUT_DIR.length > 0) {
    return env.PINGA_HOLDOUT_DIR;
  }
  return join(homedir(), ".local/state/pinga/holdout");
}

export function holdoutStorePath(
  repoRoot: string,
  task: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const repoKey = sha256hex(realpathSync(repoRoot)).slice(0, 16);
  return join(holdoutDir(env), repoKey, `${task}.json`);
}

export function examplesPlan(planPath: string, opts: { from?: string }): number {
  if (opts.from === undefined || opts.from === "") {
    console.error("uso: pinga examples <PLAN.md> --from <ARQUIVO>");
    return 2;
  }

  const resolvedPlanPath = resolve(planPath);
  const task = basename(dirname(resolvedPlanPath));

  let planText: string;
  try {
    planText = readFileSync(resolvedPlanPath, "utf8");
  } catch (err) {
    console.error(`plano ilegível: ${(err as Error).message}`);
    return 3;
  }
  const parsedPlan = parsePlan(planText);
  if (!parsedPlan.ok) {
    for (const e of parsedPlan.errors) console.error(e);
    return 3;
  }

  const gitRoot = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: dirname(resolvedPlanPath),
    stdout: "pipe",
    stderr: "pipe",
  });
  const repoRoot =
    gitRoot.exitCode === 0
      ? gitRoot.stdout.toString().trim()
      : dirname(resolvedPlanPath);

  if (!existsSync(opts.from)) {
    console.error(`arquivo não encontrado: ${opts.from}`);
    return 1;
  }

  const repoReal = realpathSync(repoRoot);
  const fromReal = realpathSync(resolve(opts.from));
  if (fromReal === repoReal || fromReal.startsWith(`${repoReal}/`)) {
    console.error("examples dentro do repo vazam o holdout");
    return 2;
  }

  const format =
    opts.from.endsWith(".yaml") || opts.from.endsWith(".yml") ? "yaml" : "json";
  let fromText: string;
  try {
    fromText = readFileSync(resolve(opts.from), "utf8");
  } catch (err) {
    console.error(`arquivo ilegível: ${(err as Error).message}`);
    return 1;
  }
  const parsed = parseExamples(fromText, format);
  if (!parsed.ok) {
    for (const e of parsed.errors) console.error(e);
    return 1;
  }
  const spec = parsed.spec;

  const { visible, holdout } = partitionExamples(spec, task);
  const visFile = resolve(join(repoRoot, visibleTestPath(task)));
  const importPath = relImportPath(
    dirname(visFile),
    join(repoRoot, spec.target.module),
  );
  const visibleContent = renderExamplesTest({
    task,
    set: "visible",
    importPath,
    exportName: spec.target.export,
    examples: visible,
  });

  let storeFile: string | null = null;
  let storeContent: string | null = null;
  if (holdout.length > 0) {
    storeFile = holdoutStorePath(repoRoot, task);
    storeContent = canonicalJson({ v: 1, task, target: spec.target, examples: holdout });
  }

  // Checagem de idempotência ANTES de gravar qualquer um dos dois arquivos.
  const DIFERE = "já existe e difere";
  if (existsSync(visFile) && readFileSync(visFile, "utf8") !== visibleContent) {
    console.error(`${visibleTestPath(task)} ${DIFERE}`);
    return 1;
  }
  if (
    storeFile !== null &&
    existsSync(storeFile) &&
    readFileSync(storeFile, "utf8") !== storeContent
  ) {
    console.error(`holdout store (${storeFile}) ${DIFERE}`);
    return 1;
  }

  mkdirSync(dirname(visFile), { recursive: true });
  writeFileSync(visFile, visibleContent);
  if (storeFile !== null && storeContent !== null) {
    mkdirSync(dirname(storeFile), { recursive: true });
    writeFileSync(storeFile, storeContent);
  }

  const holdout_sha256 = storeContent !== null ? sha256hex(storeContent) : null;
  console.log(
    canonicalJson({
      task,
      test: visibleTestPath(task),
      visible: visible.length,
      holdout: holdout.length,
      holdout_sha256,
    }),
  );
  return 0;
}

export type HoldoutRun = {
  exit: number | null;
  timedOut: boolean;
  duration_ms: number;
  artifact: { path: string; sha256: string };
};

export function runHoldout(
  repoRoot: string,
  task: string,
  attempt: number,
  timeoutMs: number,
): HoldoutRun | null {
  const storeFile = holdoutStorePath(repoRoot, task);
  if (!existsSync(storeFile)) return null;

  let target: { module: string; export: string };
  let examples: Example[];
  try {
    const raw = JSON.parse(readFileSync(storeFile, "utf8")) as {
      task?: unknown;
      target?: { module: string; export: string };
      examples?: unknown;
    };
    if (
      !isPlainObject(raw) ||
      raw.target === undefined ||
      !isPlainObject(raw.target) ||
      !Array.isArray(raw.examples)
    ) {
      return null;
    }
    if (raw.task !== undefined && raw.task !== task) return null;
    target = raw.target as { module: string; export: string };
    examples = raw.examples as Example[];
    if (examples.length === 0) return null;
  } catch {
    return null;
  }

  const runnerRel = holdoutRunnerPath(task);
  const runnerAbs = join(repoRoot, runnerRel);
  const importPath = relImportPath(
    dirname(runnerAbs),
    join(repoRoot, target.module),
  );
  const content = renderExamplesTest({
    task,
    set: "holdout",
    importPath,
    exportName: target.export,
    examples,
  });

  try {
    mkdirSync(dirname(runnerAbs), { recursive: true });
    writeFileSync(runnerAbs, content);

    const t0 = Date.now();
    const res = Bun.spawnSync(["bun", "test", `./${runnerRel}`], {
      cwd: repoRoot,
      timeout: timeoutMs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const duration_ms = Math.max(0, Date.now() - t0);
    const timedOut = Boolean(res.exitedDueToTimeout || res.exitCode === null);
    const outBuffer = Buffer.concat([
      normalizeBunTestOutput(res.stdout as Uint8Array),
      normalizeBunTestOutput(res.stderr as Uint8Array),
    ]);

    const repoKey = sha256hex(realpathSync(repoRoot)).slice(0, 16);
    const artifactPath = resolve(
      join(holdoutDir(), "runs", repoKey, task, `${attempt}.txt`),
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, outBuffer);

    return {
      exit: timedOut ? null : res.exitCode,
      timedOut,
      duration_ms,
      artifact: { path: artifactPath, sha256: sha256hex(outBuffer) },
    };
  } finally {
    rmSync(runnerAbs, { force: true });
  }
}
