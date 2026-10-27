# Gemini Instructions — P-Ingá Repository

The single source of governance for this repository is [`AGENTS.md`](./AGENTS.md). Read it
before anything else and follow it literally: it defines the invariant laws, the mandatory
contract cycle (`prove-red` → implement → `verify`) and the Queue & Executor Protocol.

Key points for this harness:

- The published root of `p-inga` is **read-only**; write only inside the `p-inga-exec`
  worktree, and only the files listed in the plan's `touch` field.
- Do not run `git commit`, `git merge` or `git push`. The operator lands work.
- Do not start parallel work: the queue hands out one task at a time, and only **one RED
  at a time** may be in flight. `pinga queue --claim` → implement → `pinga verify` with
  `--require-delta` → `pinga queue --release <T>`.

If a rule here ever conflicts with `AGENTS.md`, `AGENTS.md` wins.
