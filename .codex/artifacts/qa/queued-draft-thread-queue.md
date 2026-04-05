# Queued Follow-Up On Draft Thread QA

Date: 2026-04-05
Repo: `/Users/canal/.codex/worktrees/f606/t3code`

## Goal

Reproduce and fix the case where the composer shows an enabled `Queue` button during the first in-flight turn on a brand-new worktree thread, but clicking `Queue` does nothing.

## Red Repro

Added a browser harness repro in:

- `apps/web/src/components/ChatView.browser.tsx`

Scenario:

1. Start on a draft-only thread in `New worktree` mode with base branch `main`.
2. Send the first message so the thread is still a local draft and the first turn is in flight.
3. Type a second message.
4. Click `Queue`.

Expected:

- The second message is stored in the queued-turn store.
- No second `thread.turn.start` dispatch fires immediately.

Actual before fix:

- Queue store entry remained `undefined`.
- The button was visible and enabled, but enqueue was a no-op.

Failing command:

```bash
cd apps/web
bun run test:browser src/components/ChatView.browser.tsx -t "queues follow-ups from a brand-new worktree draft thread while the first turn is still in flight"
```

Observed failure:

- `expected undefined to deeply equal [ 'Queued from draft thread' ]`

## Root Cause

`enqueueCurrentComposerTurn` returned early unless `isServerThread` was true.

During the first in-flight turn on a brand-new draft thread, the UI can already show `Queue`, but the thread has not yet been materialized into the server-backed thread store. That made the click path bail out before enqueueing anything.

## Fix

Updated `enqueueCurrentComposerTurn` in:

- `apps/web/src/components/ChatView.tsx`

Change:

- allow enqueueing whenever `activeThread` exists
- do not require the thread to already be server-backed

This keeps queued turns attached to the draft thread id so they survive until the thread is materialized, after which normal queued dispatch logic can pick them up.

## Green Verification

Targeted red-green test:

```bash
cd apps/web
bun run test:browser src/components/ChatView.browser.tsx -t "queues follow-ups from a brand-new worktree draft thread while the first turn is still in flight"
```

Result:

- passed

Broader browser verification:

```bash
cd apps/web
bun run test:browser src/components/ChatView.browser.tsx
bun run test:browser src/components/QueuedTurnBackgroundDispatcher.browser.tsx
```

Results:

- `ChatView.browser.tsx`: `57 passed`
- `QueuedTurnBackgroundDispatcher.browser.tsx`: `3 passed`

Repo checks:

```bash
bun run fmt
bun run lint
bun run typecheck
```

Results:

- all passed

## Electron QA

Built the desktop app from this branch:

```bash
bun run build:desktop
```

Then launched the built Electron app under Playwright control using the branch build in:

- `/Users/canal/.codex/worktrees/f606/t3code/apps/desktop/dist-electron/main.js`

Live QA inventory:

1. open a fresh thread in a git-backed project
2. enable `New worktree`
3. select a base branch
4. send a first message that keeps the turn running
5. type a second message while the first turn is still in flight
6. wait for `Queue` to become enabled after worktree prep
7. click `Queue`
8. verify the queued follow-up panel appears with the queued message text

Executed live pass:

- project: `canal`
- base branch: `develop`
- first prompt: `Run sleep 20 in the terminal, then reply with exactly QA_LIVE_FIRST_20260405.`
- queued prompt: `Reply with exactly QA_LIVE_QUEUE_20260405.`

Observed result:

- `Queue` remained unavailable during the early in-flight period
- `Queue` became enabled later in the running turn
- clicking `Queue` succeeded
- the UI showed:
  - `1 queued follow-up`
  - `Waiting for the current turn to finish`
  - `QA_LIVE_QUEUE_20260405`

Evidence:

- screenshot: `/tmp/t3code-live-queue-pass.png`

Notes:

- branch discovery in this automation environment was slow; the branch list initially looked empty and then populated after a longer wait
- once the correct branch option targeting was in place, the full live queue scenario passed
