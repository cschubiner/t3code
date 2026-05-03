# QA Report

## Target

- URL or app: http://127.0.0.1:65142 and local Codex app-server probes
- Branch / commit: main / 2c74a5bccf6486dbae60e28bcab17341d8a2468d (working tree has local fix in progress)
- Target type: Electron-backed local app
- Entry command or login path: `bun run start:desktop:main-state`
- Backend used: Playwright browser against local app URL plus direct Codex app-server JSON-RPC probes
- Tier: Standard

## Claims Under Test

- Claim: Manual provider refresh should resolve promptly instead of spinning indefinitely.
- Claim: The app should send Codex turns successfully when current Codex auth is healthy.
- Claim: A previously errored Codex session should not poison subsequent sends.

## Inventory

| Area                   | Control / Route                                   | Expected State                                          | Evidence                                                        |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Settings refresh       | `/settings/general` refresh icon                  | Refresh returns and updates checked timestamp           | Playwright run updated `Checked just now` and button re-enabled |
| Codex auth probe       | `codex login status` and `account/read`           | Reports ChatGPT Pro auth                                | CLI + raw JSON-RPC probe                                        |
| Codex turn send        | `thread/start` + `turn/start` over app-server     | Returns assistant output instead of quota/runtime error | Raw app-server probe returned `OK`                              |
| Error-session recovery | Existing thread session status `error`, next send | Starts a fresh provider session before send             | Regression test added in ProviderCommandReactor.test.ts         |

## Findings

| Severity | Area             | Expected                                                  | Actual                                                                                                                 | Repro                             |
| -------- | ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| high     | Session recovery | Next send after a session error should re-establish Codex | Before fix, command reactor reused `error` sessions because only `stopped` sessions were excluded from reuse           | Code inspection + regression test |
| info     | Auth source      | T3 should use healthy Codex auth                          | `codex login status`, `~/.codex/auth.json`, and `account/read` all report ChatGPT Pro; direct app-server sends succeed | Direct probes                     |
| info     | Refresh UX       | Refresh should not spin forever                           | Could not reproduce current spin in browser QA; refresh completed and timestamp updated                                | Playwright against local app URL  |

## Fixes Applied

- Working tree patch: restart errored provider sessions before the next send in `ProviderCommandReactor.ts`
- Regression coverage added in `ProviderCommandReactor.test.ts`

## Verification

- Re-run: Playwright settings refresh check
- Result: Passed; button re-enabled and checked timestamp updated to `just now`
- Re-run: raw Codex app-server `thread/start` + `turn/start`
- Result: Passed; assistant returned `OK`

## Ship Readiness

- Passed: refresh control completes; direct Codex app-server sends succeed; regression added for error-session recovery
- Failed: could not reproduce the exact refresh spinner in browser context after rebuild
- Skipped: full Electron-only visual verification with native sidebar/project state
- Residual risk: if the stuck state is tied specifically to existing Electron thread state or a stale in-memory provider session, one more post-rebuild desktop click-through is still valuable

## Notes

- Auth was not blocked; no cookie/bootstrap needed.
- `clay.sh` exports `OPENAI_API_KEY`, but raw `account/read` still reports ChatGPT Pro and direct app-server sends succeed, so the env key does not appear to be the root cause of the current failure.
