# QA Report

## Target

- URL or app: `ClayCode (Alpha)` Electron desktop app with persisted main state
- Branch / commit: working tree in `/Users/canal/.codex/worktrees/1cce/t3code`
- Target type: Electron
- Entry command or login path: `bun run start:desktop:main-state`
- Backend used: Playwright-driven Electron automation plus SQLite state inspection
- Tier: Exhaustive in progress

## Claims Under Test

- Claim: creating a new thread from an existing thread and sending the first message persists the thread and user message correctly
- Claim: rapid `Cmd+N -> send -> Cmd+N -> send` keeps the latest draft selected and does not drop sends
- Claim: worktree-backed and local-backed new-thread flows both survive rapid sending
- Claim: session failures are surfaced and stored consistently when provider execution fails
- Claim: the exact shortcut-driven worktree draft path remains covered after rebuilding the desktop bundle from current source
- Claim: stale app-managed worktree projects should not clutter the sidebar when they have no threads and a canonical project already exists

## Inventory

| Area                                     | Control / Route                                                                                               | Expected State                                                                                                                             | Evidence                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing worktree -> button new thread   | Sidebar/button flow from known worktree thread                                                                | New thread created, user message persisted, failure/result associated with that thread                                                     | Persisted thread `f5acd178-b9a1-4795-bc4f-67c71a01a226`; session error `Quota exceeded`                                                                                                                                                        |
| Existing worktree -> shortcut new thread | `Cmd+N` from known worktree thread                                                                            | New thread created, active route stays on new draft after send                                                                             | Persisted thread `1ab51f89-8c33-4c0d-9a7d-7bca69c4b93c`; route stayed on new draft during live run                                                                                                                                             |
| Existing worktree rapid shortcut         | `Cmd+N -> send -> Cmd+N -> send`                                                                              | Both threads persist, second draft remains selected, both sessions start cleanly or fail consistently                                      | Persisted threads `d7316342-b478-46c7-8300-1bc2a8be039b` and `3e365942-b21d-4622-8129-568c4a8c9d81`; asymmetric session outcomes observed                                                                                                      |
| Current checkout exact keyboard path     | `Cmd+N -> type -> Enter -> Cmd+N -> type -> Enter` in Playwright-driven Electron launch from current worktree | Second thread persists and transitions into provider work just like the first                                                              | First send persisted on `fa090464-1f41-467e-bbce-b05790de66be`; second route `106b44c1-7d57-45e2-8669-e0f038b8f038` stayed visible but never appeared in `projection_threads`, `projection_thread_messages`, or `projection_thread_sessions`   |
| Existing local rapid shortcut            | `Cmd+N -> send -> Cmd+N -> send` from local/main-backed thread                                                | Both threads persist and fail/complete consistently                                                                                        | Persisted threads `24541c57-552d-4e78-9242-963d181d4782` and `bd3608b2-97f3-4ff5-924e-a22099289d8a`; both ended with same quota error                                                                                                          |
| Existing worktree single shortcut        | `Cmd+N -> send` from known worktree thread                                                                    | Assistant reply or explicit surfaced error                                                                                                 | User message persisted; session ended with quota error on `1ab51f89-8c33-4c0d-9a7d-7bca69c4b93c`                                                                                                                                               |
| Fresh build shortcut regression          | Browser-covered `chat.new` shortcut while a worktree draft is still preparing                                 | Second draft materializes immediately, both `thread.create` commands fire, both `thread.turn.start` commands follow once worktrees resolve | New browser regression passed on fresh build: `materializes rapid worktree drafts from the global chat.new shortcut before worktree creation resolves`                                                                                         |
| Fresh build live first-worktree draft    | New-thread button from app shell into `New worktree` flow                                                     | Base branch list should populate so the first worktree-backed send can be exercised live                                                   | Live desktop on the canonical `discord_online_status_notifier_bot` project resolved the branch selector to `From main`; stale duplicate `t3code` sidebar projects still looked suspicious because they were empty app-managed worktree entries |
| Sidebar project hygiene                  | Persisted read model with duplicate app-managed worktree projects                                             | Empty stale worktree-backed duplicates should not remain visible when a canonical project with the same title already exists               | SQLite inspection showed many empty `t3code` projects rooted in deleted `.codex/worktrees/...`; store-level filtering was added so those zombie rows no longer surface in the sidebar on snapshot sync                                         |

## Findings

| Severity | Area                                     | Expected                                                                                                             | Actual                                                                                                                                                                                                                      | Repro                                                                                                                                                                                                                  |
| -------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| high     | Sidebar project hygiene                  | The sidebar should not surface dead, empty worktree-derived projects that point at app-managed transient directories | Persisted desktop state contained many empty `t3code` project rows rooted in stale `.codex/worktrees/...` paths, creating multiple misleading `No threads yet` entries and raising the risk of routing into dead workspaces | Inspect `projection_projects` in the persisted SQLite state, compare duplicate `t3code` workspace roots against the sidebar, and observe many empty worktree-backed duplicates                                         |
| medium   | Live response verification               | Successful live runs should produce assistant output or at least a visible surfaced provider error                   | Real assistant output could not be verified because provider currently returns `Quota exceeded. Check your plan and billing details.`                                                                                       | Reproduced on multiple persisted test threads including `1ab51f89-8c33-4c0d-9a7d-7bca69c4b93c`, `24541c57-552d-4e78-9242-963d181d4782`, `bd3608b2-97f3-4ff5-924e-a22099289d8a`, `f5acd178-b9a1-4795-bc4f-67c71a01a226` |
| medium   | Error surfacing in cold-launch UI checks | Opening an errored thread should show the relevant failure in the thread view                                        | One cold-launch navigation pass landed on the empty project shell instead of the intended thread, so UI-level error-surface verification remains incomplete                                                                 | Launch desktop app cold and route directly to recent errored thread ids; one pass returned to root shell                                                                                                               |

## Fixes Applied

- Guarded project draft mapping so late context updates from an older draft cannot reclaim the active draft slot for a project
- Added regression coverage for late draft-context updates and earlier-draft promotion while a later draft remains active
- Changed first-send worktree handling so a fresh draft dispatches `thread.create` before waiting for `git.createWorktree`, then updates branch/worktree metadata once preparation finishes
- Scoped transient local-dispatch and in-flight-send guards to the active thread so one pending draft send does not silently block a different draft thread
- Filtered empty duplicate app-managed worktree projects out of snapshot sync when a canonical project with the same title already exists

## Verification

- Re-run: `bun run --cwd apps/web test -- composerDraftStore.test.ts`
- Result: pass
- Re-run: `bun run --cwd apps/web test:browser -- --run src/components/ChatView.browser.tsx -t "(creates and sends from a fresh draft while an earlier worktree draft is still preparing|keeps the latest draft selected when an earlier worktree draft is promoted)"`
- Result: pass
- Re-run: `bun run --cwd apps/web test queuedTurnEngine.test.ts queuedTurnStore.test.ts ChatView.logic.test.ts`
- Result: pass
- Re-run: `bun run --cwd apps/web test:browser -- --run src/components/ChatView.browser.tsx -t "(materializes rapid worktree drafts before worktree creation resolves|creates and sends from a fresh draft while an earlier worktree draft is still preparing|keeps the latest draft selected when an earlier worktree draft is promoted)"`
- Result: pass
- Re-run: `bun run --cwd apps/web test:browser -- --run src/components/ChatView.browser.tsx -t "(materializes rapid worktree drafts before worktree creation resolves|materializes rapid worktree drafts from the global chat.new shortcut before worktree creation resolves|creates and sends from a fresh draft while an earlier worktree draft is still preparing|keeps the latest draft selected when an earlier worktree draft is promoted|creates a new thread from the global chat.new shortcut)"`
- Result: pass
- Re-run: `bun run --cwd apps/web test:browser -- --run src/components/ChatView.browser.tsx -t "(queues next up with mod\+shift\+enter during a running turn|sends directly instead of auto-pausing into the queue when an idle thread has a stale local error|keeps a persisted paused queue paused after reload until resume is clicked)"`
- Result: pass
- Re-run: `bun run --cwd apps/web test:browser -- --run src/components/QueuedTurnBackgroundDispatcher.browser.tsx`
- Result: pass
- Re-run: `bun run --cwd apps/server test codexAppServerManager.test.ts ProviderService.test.ts ProviderCommandReactor.test.ts`
- Result: pass
- Re-run: `bun run --cwd apps/server test providerService.integration.test.ts orchestrationEngine.integration.test.ts`
- Result: pass
- Re-run: `bun run --cwd apps/server test ProviderRuntimeIngestion.test.ts ProviderCommandReactor.test.ts providerService.integration.test.ts orchestrationEngine.integration.test.ts`
- Result: pass
- Re-run: `bun run --cwd apps/web test store.test.ts`
- Result: pass
- Re-run: `bun fmt`
- Result: pass
- Re-run: `bun lint`
- Result: pass
- Re-run: `bun typecheck`
- Result: pass

## Ship Readiness

- Passed: message persistence for many single-send and rapid-send scenarios; local rapid sends both persisted and reached consistent provider failure state; worktree button send persisted and failed cleanly; active-route stability improved by store fixes and targeted browser tests; queue/store/dispatcher automated coverage is green across client and server layers; overlapping worktree drafts now materialize immediately in browser regression coverage and both sends dispatch while worktree creation is still pending; the exact shortcut-driven worktree race is now covered in browser automation on fresh source builds
- Failed: real assistant completion verification is still blocked by provider quota, so provider-backed response delivery cannot yet be declared healthy end to end
- Skipped: a fully successful live provider-backed reply, because quota errors still block end-to-end assistant completion
- Residual risk: earlier live rapid-send failures were observed before the desktop bundle was rebuilt; after rebuilding, the shortcut/worktree regression is green in automation, the canonical `discord_online_status_notifier_bot` worktree draft resolves `main` live, and the remaining user-facing risk is stale sidebar state from old app-managed worktree projects in persisted databases

## Notes

- No auth bootstrap was needed; testing used the persisted desktop state directory.
- The desktop bundle was rebuilt from current source before the latest QA pass so browser and live checks were not comparing against stale `apps/web/dist` or `apps/server/dist`.
- Current provider state is materially affecting end-to-end QA because Codex threads are failing with `Quota exceeded. Check your plan and billing details.`
