# Queue + Steer Switching QA - 2026-05-02

## Scope

Electron QA for queue and steer behavior under fast context switching: multiple threads, switching away mid-run, queue isolation, returning after settle, and steer targeting.

## Environment

- App: Electron production build from `bun run start:desktop`
- Profile: `/tmp/t3code-electron-qa-home-queue-switching`
- QA projects: `/tmp/qa-project-queue-switch-a`, `/tmp/qa-project-queue-switch-b`
- Backend: Computer Use driving Electron
- Branch: `codex/rebuild-feature-rollout`

## QA Inventory

- Queue items in thread A while thread A is running, switch to thread B, and verify A queue does not appear in B.
- Start thread B while thread A is still running, queue B follow-ups, and verify B queue stays isolated from A.
- Return to thread A before and after settle; verify queued A follow-ups dispatch only in thread A and in FIFO order.
- Return to thread B before and after settle; verify queued B follow-ups dispatch only in thread B and in FIFO order.
- Send a steer message while one thread is running, switch away immediately, and verify the steer affects only the originating active thread.
- Switch projects while a thread has queued follow-ups and verify project/sidebar context does not leak queue UI.
- Reload or relaunch with queued follow-ups pending if time allows, verifying localStorage queue hydration.

## Manual Scenarios

| Scenario                                              | Result  | Evidence                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Queue A while A is running, then switch to B          | Pass    | Started thread A with `sleep 75`; queued `A_QUEUE_ONE_DONE` and `A_QUEUE_TWO_DONE`; switched to project/thread B while A was still running. B showed no A queue panel or A queued text.                                                                                                                                                                                                         |
| Queue B while A has queued work in the background     | Pass    | Started thread B with `sleep 90`; queued `B_QUEUE_ONE_DONE`. B showed exactly `1 queued follow-up`, with B text only. A's queued items stayed scoped to A.                                                                                                                                                                                                                                      |
| Return to A after A settles                           | Pass    | On returning to A, the app showed `A_BASE_DONE`, auto-dispatched A's first queued follow-up in A, kept A's second queued follow-up disabled while A's first was active, then completed `A_QUEUE_ONE_DONE` followed by `A_QUEUE_TWO_DONE`.                                                                                                                                                       |
| Draft blocks queue auto-dispatch without losing queue | Pass    | In B, after `B_BASE_DONE`, a composer draft `B queued second: reply exactly B_QUEUE_TWO_DONE.` was present while the B queue had `B_QUEUE_ONE_DONE` ready. The queued item did not auto-dispatch until manually sent, and the draft stayed intact.                                                                                                                                              |
| Send queued follow-up now while draft exists          | Pass    | Clicked `Send queued follow-up now` for B's queued first item. It dispatched only `B_QUEUE_ONE_DONE`, preserved the separate B draft, and did not clear or send the draft out of order.                                                                                                                                                                                                         |
| Switch away and back with preserved draft             | Pass    | Switched from B to A and back after queue work completed. B's draft was still present and no A queue state leaked into B. Sending the draft then produced `B_QUEUE_TWO_DONE`.                                                                                                                                                                                                                   |
| Fast switch between projects with queued work         | Pass    | During the A/B overlap, sidebar project switching did not leak queued panel state across projects; thread headers and composer state updated to the active project/thread.                                                                                                                                                                                                                      |
| Steer while switching via Computer Use `set_value`    | Blocked | Two attempted live steer-switch runs (`sleep 45` and `sleep 20`) were invalidated because the Computer Use accessibility `set_value` operation on the running composer coincided with a real `thread.turn.interrupt` command in server traces. The command process continued and later completed, but the turn was already marked interrupted, so no user-facing steer result could be trusted. |

## Automated Checks

| Check                                                                                             | Result | Notes                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider trace review                                                                             | Pass   | Confirmed queue outcomes in Electron UI and confirmed the failed steer attempts were interrupted turns, not normal completions. Server trace contained `thread.turn.interrupt` for the steer attempts at the same time the accessibility value-set path ran. |
| `bun run --cwd apps/web test:browser src/components/ChatView.browser.tsx -t "steers immediately"` | Pass   | 2 tests passed, 85 skipped. Covers Enter and mod+Enter steer behavior during an active turn.                                                                                                                                                                 |
| `bun run --cwd apps/web test:browser src/components/ChatView.browser.tsx -t "queues with Tab"`    | Pass   | 1 test passed, 86 skipped. Covers queueing with Tab during an active turn and auto-dispatch after settle.                                                                                                                                                    |
| `bun run --cwd apps/web test:browser src/components/QueuedFollowUpsPanel.browser.tsx`             | Pass   | 3 tests passed. Covers queue row actions, disabled send-now state, and `Alt+Up`/`Alt+Down` row focus behavior.                                                                                                                                               |
| `bun fmt`                                                                                         | Pass   | `oxfmt` completed successfully on 817 files.                                                                                                                                                                                                                 |
| `bun lint`                                                                                        | Pass   | 0 errors; 8 pre-existing warnings remained.                                                                                                                                                                                                                  |
| `bun typecheck`                                                                                   | Pass   | 8 Turbo typecheck tasks successful.                                                                                                                                                                                                                          |
| `bun run test`                                                                                    | Pass   | 9 Turbo test tasks successful; server suite reported 81 files passed / 800 tests passed / 2 skipped, web suite reported 88 files passed / 919 tests passed.                                                                                                  |

## Findings

- No queue isolation, FIFO, or draft-preservation regressions found in this pass.
- The live steer-switch scenario remains blocked in Computer Use because accessibility value-setting during a running turn can trigger a real interrupt command. I did not treat that as a Queue + Steer product failure because the operation path differs from a real keyboard user and contradicts the earlier successful basic Electron steer pass.

## Residual Risks

- Live steer + immediate project switch was not successfully re-verified in this switching pass due to the Computer Use `set_value` interruption behavior above.
- Queue persistence across reload with pending queued follow-ups was not re-run in this pass.
- The stale `Codex provider status` warning banner (`Codex CLI is installed but failed to run. Timed out while running command.`) remained visible during parts of the session, even while provider turns were otherwise succeeding.
