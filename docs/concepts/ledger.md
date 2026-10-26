---
title: Hash-Chained Ledger
section: Core Concepts
order: 2
---

# Hash-Chained Append-Only Ledger

The P-Ingá Ledger (`ledger.db`) is an immutable, append-only SQLite store that cryptographically seals every task verification receipt.

## Cryptographic Structure

Every receipt block contains:
- `seq`: Monotonically increasing sequence integer (`1, 2, 3...`)
- `id`: UUIDv4 receipt identifier
- `task`: Task name (e.g. `T32`)
- `status`: Quad formal status (`pass`, `fail`, `blocked`, `not run`)
- `prev_hash`: SHA-256 digest of the previous canonical JSON block
- `hash`: SHA-256 digest of the current canonical JSON block
- `created_at`: ISO 8601 UTC timestamp

```mermaid
graph LR
  B49["Block #49<br/>hash: e7a..."] --> B50["Block #50<br/>prev_hash: e7a...<br/>hash: 18f..."]
  B50 --> B51["Block #51<br/>prev_hash: 18f...<br/>hash: bb3..."]
  classDef block fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
  class B49,B50,B51 block;
```

## Anti-Tampering SQL Triggers

The database schema registers hard database triggers that prevent any modifications:

```sql
CREATE TRIGGER IF NOT EXISTS receipts_no_update
BEFORE UPDATE ON receipts
BEGIN
  SELECT RAISE(FAIL, 'ledger is append-only: updates forbidden');
END;

CREATE TRIGGER IF NOT EXISTS receipts_no_delete
BEFORE DELETE ON receipts
BEGIN
  SELECT RAISE(FAIL, 'ledger is append-only: deletes forbidden');
END;
```

If any actor attempts `UPDATE receipts` or `DELETE FROM receipts`, SQLite raises a hard failure and aborts the transaction.

## Verification

To verify the cryptographic chain of custody:

```bash
bun .pinga/pinga-stable ledger verify
```
