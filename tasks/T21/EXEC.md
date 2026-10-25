# EXEC T21 — TDD Provisional Tests & Gira-G Integration

- **Task:** T21
- **Goal:** Implement `isProvisionalTest` in `src/guards.ts`, update `evaluateGuards` to grant immunity to provisional tests, add `checkGiraStatus` in `src/doctor.ts`, and add `pinga tdd` subcommand in `src/cli.ts`.
- **Files to touch:** `src/guards.ts`, `src/doctor.ts`, `src/cli.ts`
- **Tests to pass:** `bun test tests/provisional.test.ts`
- **Invariants:** Do not touch `tests/provisional.test.ts` or any other test file. Keep full test suite passing (`bun test`).
