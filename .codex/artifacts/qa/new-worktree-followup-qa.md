# QA Report: New worktree follow-up controls

Date: 2026-03-25
Repo: /Users/canal/.t3/worktrees/t3code/t3code-f0403230

## Claim
After the first message in a `New worktree` thread, `Queue` and `Steer` should become available before the provider reaches `running` or at least without the long multi-second delay previously observed.

## Inventory
- Create a draft thread in `New worktree` mode.
- Send the first message.
- Verify the UI leaves the strict submit/prep state once the first turn has been submitted.
- Verify `Queue` can enqueue a follow-up before the old long delay window.
- Verify the steer affordance returns promptly in the desktop app.

## Automated results
- `bun fmt`: passed
- `bun lint`: passed with 3 pre-existing warnings unrelated to this change
- `bun typecheck`: passed
- `cd apps/web && bun run test:browser src/components/ChatView.browser.tsx`: passed

## Browser regression evidence
- Added and passed a browser test covering the new-worktree first-send path and the pre-running follow-up window.
- Verified in the test harness that:
  - the first send issues `git.createWorktree`
  - the first send issues `thread.create` and `thread.turn.start`
  - `Queue` becomes available before the old delayed state and dispatches `thread.turn.queue.enqueue`
  - the steer shortcut dispatches another `thread.turn.start` in that same window

## Desktop smoke check
Used Quartz/AppKit-driven interaction against the live Electron app launched with `bun run start:desktop:main-state`.

### Steps exercised
- Activated the running `T3 Code (Alpha)` window.
- Created a fresh thread with the app's new-thread shortcut.
- Confirmed the thread was in worktree mode.
- Sent the first message.
- Immediately focused the composer again and pasted a second follow-up.
- Captured the composer state at two times.

### Desktop evidence
- Fresh worktree thread before first send: `/tmp/t3code-desktop-current-10.png`
- About 200ms after first send, with second prompt already typed: `/tmp/t3code-desktop-fast-followup-2.png`
  - composer still showed the transient spinner state
  - `Queue` and `Steer` were not visible yet
- About 600ms later on the same thread: `/tmp/t3code-desktop-fast-followup-3.png`
  - `Steer` and `Queue` were visible in the composer footer
  - this is far earlier than the previously reported ~10 second wait

## Status
- Automated regression: pass
- Repo validation gates: pass
- Desktop smoke check: pass for the reported delay regression

## Residual risk
- The desktop evidence shows a short transient submit state still exists immediately after the first send.
- The reported long blocked window was not reproduced after the fix; controls returned within well under a second in the live app on this machine.
- The auth warning banner visible in screenshots is unrelated to this composer behavior.
