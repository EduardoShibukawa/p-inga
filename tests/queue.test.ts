import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import { applyBaseline, changedFiles, evaluateGuards, fileDigest } from "../src/guards";
import {
  baselinePath,
  claim,
  formatQueueDigest,
  nextTask,
  NOTIFY_STATES,
  readSnapshot,
  release,
  scanQueue,
  transitions,
  writeSnapshot,
} from "../src/queue";
import { type Receipt } from "../src/receipt";
import { lastMeaningfulLine, supersedeTask } from "../src/supersede";

function makeReceipt(task: string, status: Receipt["status"], overrides: Partial<Receipt> = {}): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${task}-${status}-${Math.random()}`,
    task,
    status,
    reason_code: status === "pass" ? null : "command_failed",
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: null, family: null },
    verified_by: null,
    summary: `${task} ${status}`,
    created_at: "2026-10-26T20:00:00.000Z",
    ...overrides,
  } as Receipt;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pinga-queue-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-queue-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  const plan = (task: string, body?: string) => {
    const dir = join(root, "tasks", task);
    mkdirSync(dir, { recursive: true });
    const content =
      body ??
      [
        "---",
        "mode: mvp",
        `goal: "${task} goal"`,
        'done_when: "true"',
        "---",
      ].join("\n");
    writeFileSync(join(dir, "PLAN.md"), `${content}\n`);
  };

  const receipt = (r: Receipt) => {
    const led = openLedger(ledgerPath);
    led.append(r);
    led.close();
  };

  return {
    root,
    ledgerPath,
    plan,
    receipt,
    scan: (opts: { probe?: boolean } = {}) =>
      scanQueue({ root, ledgerPath, probe: opts.probe ?? false }),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

describe("Q1 — pinga queue: classificação determinística de tasks", () => {
  test("1. receipt pass => done, sem probe", () => {
    const f = fixture();
    try {
      f.plan("T01");
      f.receipt(makeReceipt("T01", "pass"));
      const rep = f.scan();
      expect(rep.tasks).toHaveLength(1);
      expect(rep.tasks[0].state).toBe("done");
      expect(rep.tasks[0].receipt?.status).toBe("pass");
      expect(rep.counts.done).toBe(1);
    } finally {
      f.cleanup();
    }
  });

  test("2. PLAN sem frontmatter => invalid_plan com erro explícito, nunca open", () => {
    const f = fixture();
    try {
      f.plan("T02", "# só prosa\n\nsem frontmatter");
      const rep = f.scan();
      expect(rep.tasks[0].state).toBe("invalid_plan");
      expect(rep.tasks[0].plan_errors.length).toBeGreaterThan(0);
      expect(rep.counts.invalid_plan).toBe(1);
    } finally {
      f.cleanup();
    }
  });

  test("3. done_when exit 0 sem receipt => awaiting_receipt (não done), e open sem probe", () => {
    const f = fixture();
    try {
      f.plan("T03");
      expect(f.scan().tasks[0].state).toBe("open");
      const probed = f.scan({ probe: true });
      expect(probed.tasks[0].done_when_exit).toBe(0);
      expect(probed.tasks[0].state).toBe("awaiting_receipt");
    } finally {
      f.cleanup();
    }
  });

  test("4. receipt blocked => blocked preservando reason_code", () => {
    const f = fixture();
    try {
      f.plan("T04");
      f.receipt(makeReceipt("T04", "blocked", { reason_code: "plan_invalid" }));
      const rep = f.scan();
      expect(rep.tasks[0].state).toBe("blocked");
      expect(rep.tasks[0].reason_code).toBe("plan_invalid");
    } finally {
      f.cleanup();
    }
  });

  test("5. receipt fail => open (retentável) preservando reason_code", () => {
    const f = fixture();
    try {
      f.plan("T05");
      f.receipt(makeReceipt("T05", "fail"));
      const rep = f.scan();
      expect(rep.tasks[0].state).toBe("open");
      expect(rep.tasks[0].reason_code).toBe("command_failed");
    } finally {
      f.cleanup();
    }
  });

  test("6. probe exit != 0 => continua open, nunca awaiting_receipt", () => {
    const f = fixture();
    try {
      f.plan(
        "T06",
        ["---", "mode: mvp", 'goal: "x"', 'done_when: "false"', "---"].join("\n"),
      );
      const rep = f.scan({ probe: true });
      expect(rep.tasks[0].done_when_exit).not.toBe(0);
      expect(rep.tasks[0].state).toBe("open");
    } finally {
      f.cleanup();
    }
  });
});

describe("Q2 — lease e escolha de próxima task", () => {
  test("7. claim grava lease vivo => leased; release devolve a open", () => {
    const f = fixture();
    try {
      f.plan("T07");
      expect(claim(f.root, "T07", 600).ok).toBe(true);
      const leased = f.scan();
      expect(leased.tasks[0].state).toBe("leased");
      expect(leased.tasks[0].lease?.pid).toBe(process.pid);
      expect(leased.tasks[0].lease?.alive).toBe(true);

      const again = claim(f.root, "T07", 600);
      expect(again.ok).toBe(false);
      expect(again.reason).toContain("lease");

      release(f.root, "T07");
      expect(f.scan().tasks[0].state).toBe("open");
    } finally {
      f.cleanup();
    }
  });

  test("8. lease de pid morto não bloqueia (stale)", () => {
    const f = fixture();
    try {
      f.plan("T08");
      const dir = join(f.root, "tasks", "T08");
      writeFileSync(
        join(dir, ".lease"),
        JSON.stringify({ pid: 999999, started_at: new Date().toISOString(), ttl_s: 600 }),
      );
      const rep = f.scan();
      expect(rep.tasks[0].state).toBe("open");
      expect(rep.tasks[0].lease?.alive).toBe(false);
      expect(claim(f.root, "T08", 600).ok).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  test("9. nextTask escolhe menor número open, ignorando done/blocked/invalid", () => {
    const f = fixture();
    try {
      f.plan("T10");
      f.plan("T2");
      f.plan("T03");
      f.receipt(makeReceipt("T2", "pass"));
      f.plan("T04", "sem frontmatter");
      const rep = f.scan();
      const n = nextTask(rep.tasks);
      expect(n?.task).toBe("T03");
      expect(rep.tasks.map((t) => t.task)).toEqual(["T2", "T03", "T04", "T10"]);
    } finally {
      f.cleanup();
    }
  });

  test("10b. --probe TASK restringe o probe; as demais não são executadas", () => {
    const f = fixture();
    try {
      f.plan("T30");
      f.plan("T31");
      const rep = scanQueue({ root: f.root, ledgerPath: f.ledgerPath, probe: true, probeTask: "T30" });
      const byTask = Object.fromEntries(rep.tasks.map((e) => [e.task, e]));
      expect(byTask.T30.state).toBe("awaiting_receipt");
      expect(byTask.T30.done_when_exit).toBe(0);
      expect(byTask.T31.state).toBe("open");
      expect(byTask.T31.done_when_exit).toBeNull();
    } finally {
      f.cleanup();
    }
  });

  test("10c. probe com timeout não trava e não inventa done", () => {
    const f = fixture();
    try {
      f.plan("T32", ["---", "mode: mvp", 'goal: "x"', 'done_when: "sleep 30"', "---"].join("\n"));
      const started = Date.now();
      const rep = scanQueue({
        root: f.root,
        ledgerPath: f.ledgerPath,
        probe: true,
        probeTask: "T32",
        probeTimeoutMs: 300,
      });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(rep.tasks[0].done_when_exit).not.toBe(0);
      expect(rep.tasks[0].state).toBe("open");
    } finally {
      f.cleanup();
    }
  });

  test("11. snapshot + transitions + digest: só blocked/invalid_plan/done avisam", () => {
    const f = fixture();
    try {
      f.plan("T40");
      f.plan("T41");
      const first = f.scan();
      expect(transitions({}, first)).toHaveLength(2);
      expect(transitions({}, first).every((t) => t.from === null)).toBe(true);

      writeSnapshot(f.root, first);
      expect(readSnapshot(f.root)).toEqual({ T40: "open", T41: "open" });
      expect(transitions(readSnapshot(f.root), first)).toHaveLength(0);

      f.receipt(makeReceipt("T40", "blocked", { reason_code: "tests_frozen_changed" }));
      const second = f.scan();
      const changes = transitions(readSnapshot(f.root), second);
      const notifying = changes.filter((c) => NOTIFY_STATES.includes(c.to));
      expect(notifying).toEqual([{ task: "T40", from: "open", to: "blocked" }]);
      const digest = formatQueueDigest(second, changes);
      expect(digest).toContain("T40: open -> blocked");
      expect(digest).toContain("reason=tests_frozen_changed");
      expect(digest).toContain("blocked 1");
    } finally {
      f.cleanup();
    }
  });

  test("12. awaiting_receipt só é escolhido se não houver open", () => {
    const f = fixture();
    try {
      f.plan("T20");
      f.plan("T21", ["---", "mode: mvp", 'goal: "x"', 'done_when: "false"', "---"].join("\n"));
      const rep = f.scan({ probe: true });
      expect(rep.tasks.find((t) => t.task === "T20")?.state).toBe("awaiting_receipt");
      expect(nextTask(rep.tasks)?.task).toBe("T21");
    } finally {
      f.cleanup();
    }
  });
});

describe("13. baseline de claim isola o drift de trabalho anterior", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  test("claim fotografa o que já estava sujo; só o que muda depois conta como drift", () => {
    const root = mkdtempSync(join(tmpdir(), "pinga-baseline-"));
    try {
      git(root, "init", "-q");
      git(root, "config", "user.email", "t@example.test");
      git(root, "config", "user.name", "test");
      writeFileSync(join(root, ".gitignore"), "tasks/*/.lease\ntasks/*/.baseline.json\n");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
      mkdirSync(join(root, "tasks/T90"), { recursive: true });
      writeFileSync(
        join(root, "tasks/T90/PLAN.md"),
        ['---', "mode: mvp", 'goal: "x"', 'done_when: "true"', "---"].join("\n"),
      );
      git(root, "add", "-A");
      git(root, "commit", "-qm", "base");

      // trabalho NÃO commitado herdado de uma task anterior
      writeFileSync(join(root, "src/a.ts"), "export const a = 2;\n");
      expect(changedFiles(root, "HEAD")).toContain("src/a.ts");

      expect(claim(root, "T90").ok).toBe(true);
      const baseline = JSON.parse(readFileSync(baselinePath(root, "T90"), "utf8"));
      expect(baseline.v).toBe(1);
      expect(baseline.head).toBe(git(root, "rev-parse", "HEAD"));
      expect(baseline.dirty["src/a.ts"]).toBe(fileDigest(root, "src/a.ts"));

      const drift = changedFiles(root, "HEAD");
      expect(drift).toContain("src/a.ts");
      expect(drift).not.toContain("tasks/T90/.lease");
      expect(applyBaseline(root, drift, baseline.dirty)).not.toContain("src/a.ts");
      // o HEAD do claim é a base: commits anteriores a ele não entram no diff
      expect(baseline.head).toMatch(/^[0-9a-f]{40}$/);

      // tocar o arquivo DEPOIS do claim volta a contar como drift
      writeFileSync(join(root, "src/a.ts"), "export const a = 3;\n");
      expect(applyBaseline(root, changedFiles(root, "HEAD"), baseline.dirty)).toContain("src/a.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("14. delta_no_touch: recibo exige trabalho real", () => {
  test("14a. arquivo declarado no touch mudou => passa", () => {
    const r = evaluateGuards({
      task: "T90",
      touch: ["src/a.ts"],
      changed: ["src/a.ts"],
    });
    expect(r.ok).toBe(true);
  });

  test("14b. nenhum arquivo do touch mudou => delta_no_touch exit 7", () => {
    const r = evaluateGuards({
      task: "T90",
      touch: ["src/a.ts"],
      changed: [],
      requireDelta: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason_code).toBe("delta_no_touch");
    expect(r.exit).toBe(7);
  });

  test("14c. metadado da task conta como delta (contrato de guards.test.ts)", () => {
    expect(
      evaluateGuards({
        task: "T90",
        touch: ["src/a.ts"],
        changed: ["tasks/T90/EXEC.md", "tasks/T90/EVAL.md"],
        requireDelta: true,
      }).ok,
    ).toBe(true);
  });

  test("14c2. sem requireDelta o no-op segue aceito (verify manual)", () => {
    expect(
      evaluateGuards({ task: "T90", touch: ["src/a.ts"], changed: [] }).ok,
    ).toBe(true);
  });

  test("14d. scope_drift tem precedência sobre delta_no_touch", () => {
    const r = evaluateGuards({
      task: "T90",
      touch: ["src/a.ts"],
      changed: ["src/outro.ts"],
      requireDelta: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason_code).toBe("scope_drift");
    expect(r.exit).toBe(6);
  });

  test("14e. allowNoDelta desarma só a régua de delta", () => {
    expect(
      evaluateGuards({
        task: "T90",
        touch: ["src/a.ts"],
        changed: [],
        requireDelta: true,
        allowNoDelta: true,
      }).ok,
    ).toBe(true);
    const drift = evaluateGuards({
      task: "T90",
      touch: ["src/a.ts"],
      changed: ["src/outro.ts"],
      requireDelta: true,
      allowNoDelta: true,
    });
    expect(drift.ok).toBe(false);
  });
});

describe("15. superseded: task cujo contrato já está verde no base", () => {
  function gitInit(root: string) {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "t"], { cwd: root });
  }

  test("15a. done_when verde sela recibo blocked/superseded e sai da fila", () => {
    const f = fixture();
    try {
      gitInit(f.root);
      f.plan("T91");
      const code = supersedeTask(join(f.root, "tasks", "T91", "PLAN.md"), {
        reason: "contrato já verde no HEAD",
        ledgerPath: f.ledgerPath,
      });
      expect(code).toBe(0);

      const rep = f.scan();
      expect(rep.tasks[0].state).toBe("superseded");
      expect(rep.counts.superseded).toBe(1);
      expect(rep.tasks[0].reason_code).toBe("superseded");
      expect(rep.tasks[0].receipt?.status).toBe("blocked");
      expect(nextTask(rep.tasks)).toBeNull();

      const art = join(f.root, "runs", "T91", "supersede", "out.txt");
      expect(readFileSync(art, "utf8")).toBeDefined();
    } finally {
      f.cleanup();
    }
  });

  test("15b. done_when vermelho não sela nada (a task precisa de correção)", () => {
    const f = fixture();
    try {
      gitInit(f.root);
      f.plan(
        "T92",
        [
          "---",
          "mode: mvp",
          'goal: "T92 goal"',
          'done_when: "false"',
          "---",
        ].join("\n"),
      );
      const code = supersedeTask(join(f.root, "tasks", "T92", "PLAN.md"), {
        reason: "tentativa indevida",
        ledgerPath: f.ledgerPath,
      });
      expect(code).toBe(4);
      const rep = f.scan();
      expect(rep.tasks[0].state).toBe("open");
      expect(rep.counts.superseded).toBe(0);
    } finally {
      f.cleanup();
    }
  });

  test("15c. task com pass não pode ser superseded", () => {
    const f = fixture();
    try {
      gitInit(f.root);
      f.plan("T93");
      f.receipt(makeReceipt("T93", "pass"));
      const code = supersedeTask(join(f.root, "tasks", "T93", "PLAN.md"), {
        reason: "atalho indevido",
        ledgerPath: f.ledgerPath,
      });
      expect(code).toBe(5);
      expect(f.scan().tasks[0].state).toBe("done");
    } finally {
      f.cleanup();
    }
  });

  test("15d. sem --reason não sela nada", () => {
    const f = fixture();
    try {
      gitInit(f.root);
      f.plan("T94");
      const code = supersedeTask(join(f.root, "tasks", "T94", "PLAN.md"), {
        reason: "   ",
        ledgerPath: f.ledgerPath,
      });
      expect(code).toBe(2);
    } finally {
      f.cleanup();
    }
  });

  test("15e. superseded não avisa: fechar sem trabalho é ato nosso (T60)", () => {
    expect(NOTIFY_STATES.includes("superseded")).toBe(false);
  });

  test("15f. lastMeaningfulLine dá a pista da falha sem abrir o artefato", () => {
    expect(lastMeaningfulLine("linha 1\n\n  (fail) expect(x).toBe(y)  \n")).toBe(
      "(fail) expect(x).toBe(y)",
    );
    expect(lastMeaningfulLine(new TextEncoder().encode("a\nb"))).toBe("b");
    expect(lastMeaningfulLine("")).toBe("");
    expect(lastMeaningfulLine("x".repeat(400)).length).toBe(201);
  });
});
