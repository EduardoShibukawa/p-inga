# Claude Code Instructions — P-Ingá Repository

All modifications to this codebase are strictly governed by P-Ingá invariants:

1. **Contract First:** Before modifying code, author `tasks/T<N>/PLAN.md` (maximum 25 lines).
2. **RED Proof:** Run `pinga prove-red tasks/T<N>/PLAN.md` to confirm baseline test failure.
3. **Surgical Implementation:** Apply minimal, focused edits. Never rewrite large files.
4. **Verification & Ledger:** Run `pinga verify tasks/T<N>/PLAN.md` and ensure `pinga ledger verify` passes.
5. **Skills:** Use `/pinga` and `/red-audit` for automated verification and adversarial loops.
