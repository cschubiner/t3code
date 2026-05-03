# QA Report

## Target

- URL or app: local desktop app
- Branch / commit: HEAD / e7ed195e
- Target type: Electron
- Entry command or login path: bun run start:desktop:main-state
- Backend used: playwright-electron-control
- Tier: Standard

## Claims Under Test

- A running thread should allow a second follow-up to be queued after the first queued/send action starts work.
- Queue should not remain disabled after the first send unless a real blocking state is active.

## Inventory

| Area                     | Control / Route                  | Expected State                                                         | Evidence                                                                                            |
| ------------------------ | -------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Composer footer          | Queue button during running turn | Enabled after first send if queueing is allowed                        | Verified in shared web composer state machine and browser regression coverage                       |
| New thread worktree flow | First send in worktree mode      | Any transient worktree-prep state clears once dispatch is acknowledged | Code inspection; live desktop automation reached app shell but not the exact destructive repro path |

## Findings

| Severity | Area                                        | Expected                                                                                                                         | Actual                                                                                                                                                                         | Repro                                                                                                                                                      |
| -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| high     | Composer queueing during first-send handoff | Queue should remain available so the second prompt can be staged while the first send is still waiting on server acknowledgement | The footer disabled `Queue` whenever `isSendBusy` was true, even though the send handler already supports converting that exact `local-dispatch` state into a queued follow-up | Start a new thread, send the first prompt, type a second prompt before the server marks the turn as running; `Queue` is disabled during the handoff window |

## Fixes Applied

- Allowed queued dispositions to use the existing `local-dispatch` gate even before a draft thread has been materialized as a server thread.
- Removed the `isSendBusy` UI disable from the composer `Queue` button so the supported queue path is actually reachable.
- Allowed the queue-front keyboard shortcut during the same local-dispatch window.
- Added focused regression coverage for the queue gating helper in `ChatView.logic.test.ts`.

## Verification

- Re-run:
- `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun run --cwd apps/web test -- src/components/ChatView.logic.test.ts`
- `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun run --cwd apps/web test:browser -- -t "shows queue actions when the latest turn is still in progress even if the session status drifted back to ready"`
- `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun fmt`
- `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun lint`
- `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun typecheck`
- Result: Passed

## Ship Readiness

- Passed: Queue gating logic, existing running-turn browser coverage, repo format/lint/typecheck gates, desktop app launch after reinstalling Electron runtime
- Failed: None in the exercised paths
- Skipped: A fully automated live reproduction on the exact persisted in-progress thread, to avoid mutating a real active session
- Residual risk: There may still be a separate state-sync issue in persisted `main-state` threads that this fix does not cover, but the specific disabled-queue handoff bug is addressed

## Notes

- Using persisted main-state profile per AGENTS instructions.
- Desktop runtime initially failed with `Electron failed to install correctly`; repaired locally via `node apps/desktop/node_modules/electron/install.js` before launch smoke checks.
- Read-only Playwright Electron smoke successfully opened the app shell and captured `/tmp/t3code-queue-live.png`.
