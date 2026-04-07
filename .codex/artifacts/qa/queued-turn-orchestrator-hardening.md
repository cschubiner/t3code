# QA Report

## Target

- URL or app: local desktop build queue orchestration paths
- Branch / commit: working tree in `/Users/canal/.codex/worktrees/f606/t3code`
- Target type: local app / browser test harness
- Entry command or login path: `bun run start:desktop:main-state` plus targeted unit/browser suites
- Backend used: local browser automation via Vitest browser and Playwright against the running desktop build
- Tier: Standard

## Claims Under Test

- Queued turns no longer dequeue on client-side dispatch success; they stay in the queue until the server acknowledges the dispatch.
- Active-thread and inactive-thread queued dispatch paths share the same lifecycle semantics.
- A single thread cannot drain multiple queued follow-ups before the first dispatch is acknowledged.
- Draft-thread materialization alone does not count as a send acknowledgement.
- Existing queue pause rules still hold for pending approvals, pending user input, and idle session errors.

## Inventory

| Area                     | Control / Route                                  | Expected State                                                                                         | Evidence                                                                              |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Queue engine             | `queuedTurnEngine.test.ts`                       | dispatch/pause/ack decisions are deterministic                                                         | `4 passed`                                                                            |
| Queue store              | `queuedTurnStore.test.ts`                        | dispatch lifecycle is tracked explicitly and ack removes the head item                                 | `20 passed` in file, `24 passed` combined run                                         |
| Active-thread queue UI   | `ChatView.browser.tsx`                           | active-thread queued head stays in place until ack and later turns do not drain                        | `67 passed`                                                                           |
| Inactive-thread queue UI | `QueuedTurnBackgroundDispatcher.browser.tsx`     | inactive-thread queue dispatch respects the same ack/lock behavior                                     | `4 passed`                                                                            |
| Live built app           | existing thread `Sleep then return queued token` | primary turn runs, two queued follow-ups stay ordered, and follow-ups dispatch one at a time after ack | screenshot `/tmp/live-queued-sequence-check.png` plus timestamped transcript evidence |
| Repo gates               | `fmt`, `lint`, `typecheck`                       | no formatting, lint, or TS regressions                                                                 | all passed                                                                            |

## Findings

| Severity | Area                            | Expected                                                                     | Actual                                                                       | Repro                                                                                      |
| -------- | ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| medium   | Draft-thread local dispatch ack | `thread.create` / materialization should not clear first-send local dispatch | local dispatch was treating a new `stopped` session as an acknowledgement    | reproduced in unit/browser investigation and fixed in `localDispatch.ts`                   |
| medium   | Queue lifecycle                 | queued head should remain until ack, not disappear on RPC success            | old behavior removed queued items immediately after dispatch command success | reproduced by new active/background queue tests and fixed via store runtime dispatch state |

## Fixes Applied

- Added explicit per-thread queued dispatch runtime state in `queuedTurnStore.ts` with `idle`, `dispatching`, and `awaiting-ack`.
- Completed the store-schema pass in `queuedTurnStore.ts`: dispatch state now persists across rehydrate, and legacy queue-store records migrate forward with an idle dispatch state.
- Added shared queue decision/ack logic in `queuedTurnEngine.ts`.
- Moved local dispatch snapshot/ack logic into `localDispatch.ts` and tightened the ack heuristic so draft thread creation does not count as send acknowledgement.
- Updated `ChatView.tsx` and `QueuedTurnBackgroundDispatcher.tsx` to use the shared lifecycle.
- Added unit coverage in `queuedTurnStore.test.ts` and `queuedTurnEngine.test.ts`.
- Added/updated browser regressions in `ChatView.browser.tsx` and `QueuedTurnBackgroundDispatcher.browser.tsx`.

## Verification

- Re-run: `cd apps/web && bun run test src/queuedTurnStore.test.ts src/queuedTurnEngine.test.ts`
- Result: `2 passed (26 tests)`
- Re-run: `cd apps/web && bun run test:browser src/components/QueuedTurnBackgroundDispatcher.browser.tsx`
- Result: `1 passed (4 tests)`
- Re-run: `cd apps/web && bun run test:browser src/components/ChatView.browser.tsx`
- Result: `1 passed (67 tests)`
- Re-run: `bun run fmt`
- Result: passed
- Re-run: `bun run lint`
- Result: passed
- Re-run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && bun run typecheck`
- Result: passed
- Re-run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && bun run build:desktop`
- Result: passed
- Re-run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && bun run start:desktop:main-state`
- Result: desktop app launched on `http://127.0.0.1:62007` / `http://127.0.0.1:62008`
- Re-run: Playwright live smoke against the running build
- Result: in `Sleep then return queued token`, the app processed `ORCH_QA_PRIMARY` at `1:23:59 AM`, then `ORCH_QA_FOLLOWUP_ONE` at `1:24:11 AM`, then `ORCH_QA_FOLLOWUP_TWO` at `1:24:15 AM`; queued follow-ups did not dispatch together
- Re-run: Playwright live smoke queuing multiple follow-ups immediately after the first send
- Result: `Queue` became visible about `674ms` after the first send, `ORCH_QA_IMMEDIATE_ONE` was queued about `1.3s` after the first send, `ORCH_QA_IMMEDIATE_TWO` about `1.9s` after the first send, the UI showed `2 queued follow-ups`, and the thread later completed in order instead of bursting them together
- Re-run: Playwright live smoke queuing multiple follow-ups, switching to another thread immediately, and returning later
- Result: on `Sleep then return queued token`, `ORCH_QA_BG2_ONE` and `ORCH_QA_BG2_TWO` were queued about `538ms` and `1024ms` after the first send, the UI showed `2 queued follow-ups`, the app switched to `Exact QA token reply` about `1133ms` after the first send, and when returning later the original thread had completed both queued follow-ups and the queue markers were gone

## Ship Readiness

- Passed: shared queue lifecycle, active/inactive dispatch lock behavior, queue pause handling, repo gates, live built-app sequential queued dispatch
- Failed: none in the final automated run
- Skipped: none for the queue sequencing path exercised here
- Residual risk: there is still separate direct-send local dispatch state outside the queued store; queue behavior is much harder to break now, but a future full unification of direct-send and queued-send ack tracking would simplify the model further. One temporary false alarm during live QA turned out to be expected UI behavior: `Queue` only appears once there is follow-up text in the composer.

## Notes

- I initially tried to keep a browser repro for the exact `thread.created` materialization race, but it was flaky and entangled with unrelated UI-entry timing. I kept that transition covered deterministically in `queuedTurnEngine.test.ts` instead.
