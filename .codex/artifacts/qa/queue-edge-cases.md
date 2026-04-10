# Queue Edge Cases QA

Date: 2026-04-10

Environment:

- Repo: `/Users/canal/.codex/worktrees/84db/t3code`
- App launch: `bun run start:desktop:main-state`
- Live state URL: `http://127.0.0.1:53546`
- Test thread: `Queue QA Repo Thread`
- Thread id: `17589a59-66b5-40ee-81dd-0f714aec5d82`

## Scope

Exercise live queued follow-up behavior in the desktop-backed web app:

- enqueue multiple follow-ups while a turn is running
- verify active-turn restrictions
- verify edit/delete behavior inside the queue panel
- probe stop/interrupt behavior with queued work waiting behind an active turn

## Result Summary

- Pass: queue affordance only appears during an active turn
- Pass: multiple queued follow-ups can be added while a turn is running
- Pass: `Send now` is disabled while the current turn is still running
- Pass: queued follow-ups can be edited and deleted in the live panel
- Pass: on the rebuilt app, queued follow-ups drained automatically in order after the active turn completed
- Pass: on the rebuilt app, stopping a running turn with queued follow-ups correctly advanced into the next queued turn
- Historical fail only: an earlier run showed a stuck-looking stop state and a provider interrupt failure, but I could not reproduce that on the rebuilt app
- Side finding: browser composer send on fresh threads showed `Failed to dispatch orchestration command`, while raw RPC `thread.turn.start` succeeded for the same thread

## Evidence

Screenshots:

- `/tmp/queue-three-items.png`
- `/tmp/queue-edit-delete-scoped.png`
- `/tmp/queue-stop-short-observation.png`

Notable live observations:

- While a repo-backed turn was active, the composer showed `Steer`, `Queue`, and `Stop generation`.
- After queueing three items, the panel showed all three queued rows and kept the active turn in front.
- Scoped row inspection confirmed:
  - row 1: `Queued follow-up alpha`
  - row 2: `Queued follow-up beta`
  - row 3: `Queued follow-up gamma`
  - row 1 `Send now` was disabled during the running turn
- Editing row 2 to `Queued follow-up beta edited` succeeded.
- Deleting row 3 succeeded.

Structured live output from the scoped edit/delete run:

```json
{
  "before": {
    "row1Text": "#1\nNext\nChat\n\nQueued follow-up alpha",
    "row2Text": "#2\nChat\n\nQueued follow-up beta",
    "row3Text": "#3\nChat\n\nQueued follow-up gamma",
    "row1SendNowDisabled": true
  },
  "after": {
    "row1Text": "#1\nNext\nChat\n\nQueued follow-up alpha",
    "row2Text": "#2\nChat\n\nQueued follow-up beta edited",
    "row3Exists": 0,
    "clearAllVisible": 1
  }
}
```

Structured live output from the short stop observation:

```json
{
  "stopStillVisible": 1,
  "resumeVisible": 0,
  "rowCount": 2,
  "pausedCopySeen": false,
  "waitingCopySeen": true
}
```

## Findings

### 1. Core queueing behavior works in the live app

Pass.

I was able to queue multiple follow-ups behind a running turn and verify the panel behavior live:

- queue rows render in order
- the first row is marked `Next`
- `Send now` stays disabled while the current turn is still running
- edit/delete actions work as expected on queued rows

### 2. Stop/interrupt behavior looks inconsistent from the browser path

Historical fail, not currently reproduced.

When I queued follow-ups behind a running turn and clicked `Stop generation`, the UI did not quickly move into a paused queue state:

- after 3 seconds, `Stop generation` was still visible
- `Resume` was not visible
- the queue still showed 2 queued rows
- the status copy still matched `Waiting for the current turn to finish`

I also tried longer waits in automation while expecting either:

- the stop button to disappear, or
- the queued rows to shrink as draining began

Those waits timed out.

Important nuance:

- a raw RPC `thread.turn.interrupt` against the same thread did work
- 3 seconds later, `orchestration.getSnapshot()` showed:
  - session `status: "ready"`
  - `activeTurnId: null`
  - latest turn `state: "completed"`

That suggests the backend interrupt path is functional, and the issue is more likely in the browser stop flow and/or state propagation after the interrupt request.

### 2b. Rebuilt app re-run behaves coherently

Pass.

I re-ran the queue scenarios live on the rebuilt desktop app with the same real thread and observed the current behavior directly through `localStorage` plus the persisted orchestration event stream.

What I observed on the rebuilt run:

- Sending `sleep 20` while the thread was idle worked normally.
- Queueing `Queued follow-up alpha` and `Queued follow-up beta` with `Meta+Shift+Enter` worked normally.
- During the active turn, the persisted queued-turn state for this thread contained:
  - `Queued follow-up beta`
  - `Queued follow-up alpha`
- The composer draft state for the same thread was `null`, so the queue shortcut was not leaving stale composer text behind.
- After the active turn completed, the queue drained automatically:
  - `Queued follow-up beta` dispatched first
  - then `Queued follow-up alpha`
- The persisted event stream recorded separate `thread.message-sent` and `thread.turn-start-requested` events for each queued follow-up.
- No merged user message appeared in the event log on the rebuilt run.

I also re-ran the stop edge case with a longer `sleep 60` turn:

- queued `Queued stop alpha`
- queued `Queued stop beta`
- clicked `Stop generation`

  3.5 seconds later, the UI still showed `Stop generation`, but that turned out to be expected:

- the stop had ended the original running turn
- the queue head had already auto-started as the next active turn
- one queued item remained behind it
- the persisted queue state showed only `Queued stop alpha` remaining

So the “stop button is still visible” state was not a browser failure on the rebuilt app. It was the next queued turn already running.

### 3. Separate side finding: browser send path on fresh threads is inconsistent

Not part of the queue panel itself, but surfaced during setup.

On fresh disposable threads created through the live app state:

- clicking the browser send button produced `Failed to dispatch orchestration command`
- the empty-state copy remained visible

However, sending the same `thread.turn.start` through the raw WebSocket RPC client succeeded for the same thread, and the thread then ran normally in the UI.

That points to a browser-path issue distinct from the server-side orchestration command itself.

## Suggested Follow-Up

- Keep the historical interrupt failure in mind if it reappears, but the current rebuilt app looks healthy for queueing, draining, and stop-with-queue behavior.

Second follow-up:

- investigate why browser send on fresh threads reports dispatch failure when raw `thread.turn.start` succeeds
