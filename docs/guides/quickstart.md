---
title: Quickstart Guide
section: Guides & Workflows
order: 1
---

# P-Ingá Quickstart Guide

Get up and running with P-Ingá formal verification in 3 simple steps.

## Step 1: Check System Health

Verify your local harnesses, toolchain, and sandbox configuration:

```bash
bun .pinga/pinga-stable doctor
```

Output:
```text
✓ mise toolchain: bun v1.4.4
✓ git sandboxing: active
✓ ledger integrity: ok 51
✓ harnesses detected: pi, claude, opencode, hermes
```

## Step 2: Audit Ledger Integrity

P-Ingá stores every verification event in an append-only, tamper-evident hash chain. Verify the full cryptographic history:

```bash
bun .pinga/pinga-stable ledger verify
```

Output:
```text
ok 51
```

If any receipt block, timestamp, or command output was tampered with, `pinga ledger verify` immediately exits with code 1 and identifies the broken sequence index.

## Step 3: Verify a Task Contract

Every task in P-Ingá is driven by a formal specification file (`PLAN.md`).

To verify a task plan against its contract:

```bash
bun .pinga/pinga-stable verify tasks/T32/PLAN.md
```

### Verification Flow

```mermaid
graph LR
  P["1. Read PLAN.md"] --> R["2. RED on Base (I15)"]
  R --> E["3. Run done_when"]
  E --> L["4. Seal Block in ledger.db"]
  classDef step fill:#38bdf8,stroke:#0284c7,stroke-width:2px,color:#0f172a;
  class P,R,E,L step;
```

When `done_when` exits with code 0, P-Ingá computes the SHA-256 digest of the execution log, signs the receipt, and appends a new block to `ledger.db`.

Next: Read about the [20 Core Invariants](../concepts/invariants.html) to understand the governance rules enforced by P-Ingá.
