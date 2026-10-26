---
title: The 20 Core Invariants
section: Core Concepts
order: 1
---

# The 20 Core Invariants of P-Ingá

P-Ingá verifies every execution against 20 inviolable rules. If any invariant is breached, the execution is blocked immediately and a failure receipt is sealed.

| Invariant | Name | Rule & Enforcement |
|:---|:---|:---|
| **I1** | Deterministic Execution | Verification must be driven by deterministic `done_when` shell commands. |
| **I2** | Quad Formal Status | Every verification step must yield one of: `pass`, `fail`, `blocked`, or `not run`. |
| **I3** | Automatic Circuit Breaker | Execution halts after 3 consecutive identical failures to prevent infinite LLM retry loops. |
| **I4** | Honest Accounting | Token counts and costs must never be fabricated; unmeasured steps must be labeled `null`. |
| **I5** | Append-Only Ledger | Receipts in SQLite can only be inserted, never updated or deleted (guaranteed by SQL triggers). |
| **I6** | Inertia Circuit Breaker | Disarms agents after 3 consecutive read actions without code mutation. |
| **I7** | Sandbox Isolation | Tests must run in isolated temporary homes with strict `PATH` sandboxing. |
| **I8** | Redaction & Privacy | Secrets (`.env`, `auth.json`, tokens) are masked across 3 defensive layers. |
| **I9** | Canaries & Integrity | Golden canary hashes ensure verification harness has not been tampered with. |
| **I10** | Monotonic Sequences | Ledger sequence numbers must strictly increment by 1 (`prev_hash` validation). |
| **I11** | Zero In-Memory Drift | State between turns is strictly persisted to disk or ledger, never held in volatilized RAM. |
| **I12** | Mode Monotonicity | Modes (`rapido`, `padrao`, `rigido`) can only be raised, never lowered silently. |
| **I13** | Multi-Harness Parity | Pi, Claude, OpenCode, Hermes, and TUIOS must conform to uniform adapter protocols. |
| **I14** | Atomic Mutations | Files modified during tasks must be written atomically via temp-file renaming. |
| **I15** | Prove RED on Base | Every task must prove failure against the base commit before code changes are accepted. |
| **I16** | Strict Scope Boundaries | Changes outside the declared `touch` list in `PLAN.md` are rejected. |
| **I17** | Frozen Test Protection | Existing regression tests can never be modified or deleted without explicit approval. |
| **I18** | Health Attestation | `pinga doctor` requires clean execution, zero exit code, and non-empty output. |
| **I19** | Zero Network Egress in Eval | Offline evaluation runs must strictly forbid outbound network sockets. |
| **I20** | Discord Observability | All verified ledger receipts must dispatch signed embeds to `#hermes / dev`. |
