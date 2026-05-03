# QA Report

## Target

- URL or app: local web app behavior exercised through `apps/web` browser tests and a live local browser session at `http://127.0.0.1:5733/`
- Branch / commit: `3d35be25bf697e0d4665dbbb656dc3ed047d6141`
- Target type: local app
- Entry command or login path: `bun x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx`, plus a live local app boot using the built server on port `3773` and Vite on port `5733`
- Backend used: Vitest browser runner with Playwright-backed Chromium, focused store reducer tests, and a headless Playwright live smoke loop against the running app
- Tier: Standard

## Claims Under Test

- Claim: A new draft thread should still appear in the left sidebar when the first user message lands before the server's `thread.created` event.
- Claim: A late real `thread.created` event should not wipe first-turn messages that already reached the client.
- Claim: New-thread draft promotion should remain stable after reducer/store updates.

## Inventory

| Area                        | Control / Route                               | Expected State                                                                                                                                                                                                             | Evidence                                                                                                                |
| --------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Draft promotion             | `/_chat/$threadId` draft route                | First user message materializes the thread in client state/sidebar even before canonical create arrives                                                                                                                    | Browser test `materializes a sent draft thread before thread.created arrives and preserves the message after create`    |
| Late create merge           | Client orchestration reducer                  | Real `thread.created` merges metadata without deleting already-seen messages                                                                                                                                               | Store test `preserves existing thread messages when a late thread.created arrives`                                      |
| Regression safety           | `apps/web` reducer + route event pipeline     | No type/lint/format regressions from the materialization fix                                                                                                                                                               | `bun fmt`, `bun lint`, `bun typecheck`                                                                                  |
| Live first-send persistence | Running local app at `http://127.0.0.1:5733/` | Sending the first message in a brand-new thread should clear the composer, keep the message visible in the thread, leave the thread row present after opening another new draft, and allow reopening from the left sidebar | Six-iteration Playwright smoke loop against `data-testid="new-thread-button"` and `data-testid="thread-row-<threadId>"` |

## Findings

| Severity | Area                       | Expected                                                                                              | Actual                                                                                                                                                                | Repro                                                                                                 |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| high     | Draft thread promotion     | A first-turn message should surface the new thread in the sidebar even if `thread.created` is delayed | Client state only promoted threads on `thread.created`, so a delayed create could leave the thread absent from the left panel and effectively "lost" after navigation | Emit `thread.message-sent` / `thread.turn-start-requested` for a draft thread before `thread.created` |
| high     | Late create reconciliation | A delayed canonical `thread.created` should enrich an existing client thread                          | Reducer replaced the whole thread on `thread.created`, which would wipe messages if the client had already materialized that thread from later events                 | Materialize a draft thread from message events, then apply `thread.created` afterward                 |

## Fixes Applied

- Added `apps/web/src/draftThreadMaterialization.ts` to synthesize client-side `thread.created` events for draft threads when thread-scoped runtime events arrive before the canonical create event.
- Updated `apps/web/src/routes/__root.tsx` to prepend those synthetic create events into the UI event pipeline and sync sidebar thread UI for them.
- Updated `apps/web/src/store.ts` so late `thread.created` events merge metadata into an existing thread instead of resetting messages and other accumulated state.
- Added regression coverage in `apps/web/src/components/ChatView.browser.tsx` and `apps/web/src/store.test.ts`.

## Verification

- Re-run: `bun x vitest run src/store.test.ts`
- Result: passed (`19` tests)
- Re-run: `bun x vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx`
- Result: passed (`56` tests)
- Re-run: `bun fmt`
- Result: passed
- Re-run: `bun lint`
- Result: passed
- Re-run: `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun typecheck`
- Result: passed
- Re-run: live Playwright smoke loop against `http://127.0.0.1:5733/`
- Result: passed `6/6` iterations
- Pass criteria per iteration:
  - create a new thread via `data-testid="new-thread-button"`
  - send a unique first message
  - confirm send started by observing composer clear or stop-generation state
  - confirm the sent message remains visible in the active thread
  - open another new draft thread
  - confirm the original thread row `data-testid="thread-row-<threadId>"` is still present in the left sidebar
  - reopen that thread row and confirm the sent message is still visible

## Ship Readiness

- Passed: delayed-create draft promotion, late-create merge safety, reducer/browser regression coverage, formatting, linting, typechecking, six consecutive live first-send/sidebar-persistence checks
- Failed: none in the fixed race path
- Skipped: long-duration soak beyond six consecutive live iterations, desktop/Electron-specific state persistence
- Residual risk: the live pass was strong enough that I did not reproduce a second independent "first send does nothing" failure after the materialization fix, but an extremely timing-sensitive provider-side issue could still require a longer soak or desktop-specific repro

## Notes

- No auth bootstrap was needed because the QA path used the local browser harness instead of a remote session.
- `bun typecheck` required Node `24.13.1`; the successful run used the installed `~/.nvm/versions/node/v24.13.1/bin/node` via `PATH` because `mise` was not available in this shell.
- During live QA, two harness assumptions turned out to be false and were corrected:
  - the browser route can stay on the local draft thread ID after send, which is expected in this app
  - the sidebar title can be quickly summarized away from the raw first-message text, so thread-row IDs were a better persistence signal than matching the exact message string
