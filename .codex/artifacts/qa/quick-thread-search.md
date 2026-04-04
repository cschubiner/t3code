# QA Report

## Target

- URL or app: T3 Code web UI components exercised through Vitest browser runs
- Branch / commit: working tree in `/Users/canal/.codex/worktrees/3fa1/t3code`
- Target type: local app
- Entry command or login path: component/browser QA via `bunx vitest run --config apps/web/vitest.browser.config.ts ...`
- Backend used: browser-rendered Vitest + Playwright provider
- Tier: Standard

## Claims Under Test

- Claim: `mod+shift+f` opens a fast recent-thread search instead of the old full-content search.
- Claim: quick search ranks title hits strongly while still surfacing first-message matches.
- Claim: `mod+shift+a` still opens the old deep search across all loaded thread content.
- Claim: docs and default keybindings reflect the new shortcut layout.

## Inventory

| Area                | Control / Route                                     | Expected State                                                                     | Evidence                                                              |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Shortcut wiring     | Sidebar `keydown` handling                          | `mod+shift+f` opens quick search dialog                                            | `apps/web/src/components/Sidebar.browser.tsx` browser test passed     |
| Shortcut wiring     | Sidebar `keydown` handling                          | `mod+shift+a` opens deep search dialog                                             | `apps/web/src/components/Sidebar.browser.tsx` browser test passed     |
| Shortcut guardrails | Sidebar `keydown` handling with dialog already open | thread-search shortcuts do not open another search surface over an existing dialog | `apps/web/src/components/Sidebar.browser.tsx` browser test passed     |
| Quick dialog UX     | Quick search dialog input                           | typing query shows title-first ranking with visible result badges                  | `apps/web/src/components/QuickThreadSearchDialog.browser.tsx` passed  |
| Quick dialog UX     | Quick search dialog states                          | empty prompt, no-results copy, and Enter-to-open behavior work                     | `apps/web/src/components/QuickThreadSearchDialog.browser.tsx` passed  |
| Deep dialog UX      | Global search dialog input                          | deep search still renders result metadata and timestamps                           | `apps/web/src/components/GlobalThreadSearchDialog.browser.tsx` passed |
| Deep dialog UX      | Global search dialog states                         | unmatched deep queries render the correct no-results state                         | `apps/web/src/components/GlobalThreadSearchDialog.browser.tsx` passed |
| Ranking logic       | quick search builder                                | title matches outrank message-only matches; ties use thread recency                | `apps/web/src/lib/quickThreadSearch.test.ts` passed                   |
| Ranking logic       | quick search builder                                | blank query handling, first-user-only indexing, and unknown project fallback work  | `apps/web/src/lib/quickThreadSearch.test.ts` passed                   |
| Contracts/defaults  | keybinding schema + defaults                        | `threads.search` on `mod+shift+f`, `threads.searchAll` on `mod+shift+a`            | contract/server/web keybinding tests passed                           |
| Repo health         | format/lint/typecheck                               | no regressions from feature build                                                  | `bun fmt`, `bun lint`, `bun typecheck` passed                         |

## Findings

| Severity | Area | Expected                                    | Actual                           | Repro |
| -------- | ---- | ------------------------------------------- | -------------------------------- | ----- |
| none     | n/a  | no user-visible regressions in tested paths | none observed in exercised flows | n/a   |

## Fixes Applied

- Working tree includes the quick-search implementation, shared dialog refactor, keybinding swap, sidebar integration tests, browser dialog coverage, and doc updates.

## Verification

- Re-run: `bun fmt`
- Result: passed
- Re-run: `bun lint`
- Result: passed
- Re-run: `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bun typecheck`
- Result: passed
- Re-run: `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bunx vitest run apps/web/src/lib/quickThreadSearch.test.ts`
- Result: passed
- Re-run: `PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" bunx vitest run --config vitest.browser.config.ts src/components/QuickThreadSearchDialog.browser.tsx src/components/GlobalThreadSearchDialog.browser.tsx src/components/Sidebar.browser.tsx` from `apps/web`
- Result: passed

## Ship Readiness

- Passed: shortcut remap, quick-search ranking, deep-search fallback, keybinding defaults, docs update, sidebar/browser coverage
- Failed: none in exercised scope
- Skipped: full end-to-end app launch against a running local server or desktop runtime was not exercised in this QA pass
- Residual risk: quick search intentionally searches only loaded recent threads and only title + first user message, so older or later-message-only matches will only appear in `mod+shift+a`

## Notes

- No auth was needed.
- The repo had a discoverable local web/browser test entry via `apps/web/package.json` and existing Vitest browser coverage, so no extra app bootstrapping was required for this QA pass.
