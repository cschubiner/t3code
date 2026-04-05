# QA Report

## Target

- URL or app: T3 Code queued follow-up dispatch for inactive threads
- Branch / commit: working tree on `/Users/canal/.codex/worktrees/f606/t3code`
- Target type: local app plus browser harness fallback
- Entry command or login path: attempted `T3CODE_HOME=/tmp/t3code-qa-home T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1 T3CODE_NO_BROWSER=1 bun run dev`
- Backend used: local dev boot attempt, then Playwright-backed Vitest browser harness
- Tier: Standard

## Claims Under Test

- Claim: Queued follow-ups for an inactive thread should auto-dispatch without needing that thread to be selected.
- Claim: Background queue dispatch should send only the head queued item until the server acknowledges the dispatch.
- Claim: The selected thread should not need to switch in order for a different thread's queued item to dispatch.

## Inventory

| Area                  | Control / Route            | Expected State                                                 | Evidence                                          |
| --------------------- | -------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Inactive thread queue | Background dispatcher      | Head queued item dispatches even when another thread is active | `QueuedTurnBackgroundDispatcher.browser.tsx` pass |
| Inactive thread queue | Queue state after dispatch | First item removed, second item remains queued                 | `QueuedTurnBackgroundDispatcher.browser.tsx` pass |
| Cross-thread safety   | Local-dispatch lock        | No second dispatch before first is acknowledged                | `QueuedTurnBackgroundDispatcher.browser.tsx` pass |
| Full local app        | `bun run dev` startup      | Browser-accessible app for manual smoke verification           | Blocked by Bun/server startup failure             |

## Findings

| Severity | Area                 | Expected                                                    | Actual                                                                                                                                                        | Repro                                                                                                                                                                 |
| -------- | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| medium   | Local QA environment | Local app should boot for manual browser smoke verification | `apps/server` crashed on startup under local Bun `1.3.10` with `No such built-in module: node:sqlite`, so full app smoke QA could not run in this environment | `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; T3CODE_HOME=/tmp/t3code-qa-home T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD=1 T3CODE_NO_BROWSER=1 bun run dev` |

## Fixes Applied

- No additional code fixes during QA.
- Verified the previously added background dispatcher and regression test.

## Verification

- Re-run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun run fmt`
- Result: passed
- Re-run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun run lint`
- Result: passed
- Re-run: `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun run typecheck`
- Result: passed
- Re-run: `cd apps/web && export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"; bun run test:browser src/components/QueuedTurnBackgroundDispatcher.browser.tsx`
- Result: passed (`1` file, `1` test)

## Ship Readiness

- Passed: inactive-thread queued dispatch behavior; single-head dispatch safety lock; static verification (`fmt`, `lint`, `typecheck`)
- Failed: none in the targeted behavior under the browser harness
- Skipped: manual full-app browser smoke check, because local server startup was environment-blocked
- Residual risk: a full live UI pass against the dev app is still worth doing once Bun `1.3.9` or an equivalent working local runtime is available, mainly to verify the exact sidebar/thread-selection interaction in the assembled app shell

## Notes

- No auth was needed for the browser harness run.
- Full local app QA was blocked by tool/runtime mismatch rather than by the queued-dispatch code path itself.
