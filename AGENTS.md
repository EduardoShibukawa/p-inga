# P-Ingá Repository Governance

This repository contains **P-Ingá**, the formal verification harness enforcing invariants (I1–I20), immutable hash-chained receipts (`ledger.db`), distinct family judging, and meta-learning.

## Invariant Laws for Autonomous Agents

1. **Lei 1: Token Economy & Prefix Stability**
   - `tasks/T<N>/PLAN.md` must **never exceed 25 lines** total.
   - Frontmatter must include: `mode` (mvp | padrao | completo), `goal`, `done_when`, `touch`.
   - Conversational prefix stability must be preserved.

2. **Lei 2: Mandatory Formal Verification**
   - No code is accepted without a passing contract execution.
   - Run `pinga prove-red tasks/T<N>/PLAN.md` before implementing.
   - Run `pinga verify tasks/T<N>/PLAN.md` after implementing.
   - Ensure `pinga ledger verify` outputs `ok <count>`.

3. **Lei 3: Distinct Family Judging (I13)**
   - Models must never review or judge outputs from their own LLM family.

4. **Test Suite Immunity (I5)**
   - Official test suites in `tests/` are immutable frozen references during task diagnosis.
   - Provisional scratch tests may be added with prefix `tests/scratch_*.ts`.

## Key Commands

- `pinga verify <PLAN.md>` — Execute contract, record tokens, sign receipt, append to ledger.
- `pinga prove-red <PLAN.md>` — Prove test failure on base commit.
- `pinga ledger verify` — Verify SHA256 chain integrity of ledger.db.
- `pinga doctor` — Check health of multi-harness adapters (Claude, Pi, OpenCode, Hermes, TUIOS).
- `pinga maestro scoreboard` — Display token efficiency & FTPR metrics.
- `bun test` — Run full repository test suite.

## Queue & Executor Protocol

The published root is **read-only** for every agent: never edit files inside the primary
checkout of `p-inga`. All execution happens in the sibling worktree `p-inga-exec` (branch
`work/exec`), reset to `origin/main` only while its tree is clean. Never run `git commit`,
`git merge` or `git push` — the operator lands work.

Open tasks are handed out by the queue, and **one RED at a time** runs per worktree:

1. `pinga queue --json` — if `counts.open` and `counts.awaiting_receipt` are both 0, stop.
2. `pinga queue --claim --json` — take the lease. A `claimed` of `null` means someone else
   holds it: stop, never steal the lease.
3. Implement **only** the files listed in the plan's `touch` field, satisfying `done_when`.
4. `pinga verify tasks/<T>/PLAN.md --require-delta` — `--require-delta` is mandatory for an
   autonomous receipt: `pass` demands a real change in a `touch` file since the claim.
5. `pinga queue --release <T>` — always release the lease, even when the receipt is `blocked`.

Artifacts (`runs/<T>/<attempt>/out.txt` and prove/judge output) are gitignored: they stay
on disk as evidence and never enter the commit.
