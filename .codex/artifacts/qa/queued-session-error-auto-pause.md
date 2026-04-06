# Queued Session Error Auto-Pause QA

Date: 2026-04-06

## Repro

Observed report:

- a thread had follow-ups queued
- the provider/session hit a timeout-like error state
- queued follow-ups were dispatched automatically instead of pausing for manual recovery

Red regression added:

- `apps/web/src/components/ChatView.browser.tsx`
- test: `auto-pauses active-thread queued follow-ups for an idle session error`

Red behavior before the fix:

- a thread with `session.status = "error"` and queued follow-ups immediately auto-dispatched the first queued turn
- expected behavior was to pause the queue as `session-error` and leave the queued items intact

## Fix

Added `deriveQueuedTurnAutoPauseReason(...)` in `apps/web/src/queuedTurnStore.ts`.

Applied that auto-pause rule to both:

- active-thread queue dispatch in `apps/web/src/components/ChatView.tsx`
- background queue dispatch in `apps/web/src/components/QueuedTurnBackgroundDispatcher.tsx`

Behavior after the fix:

- idle errored sessions auto-pause queued follow-ups with `session-error`
- manual recovery paths are preserved because the generic dispatch gate still allows explicit retry/resume flows

## Validation

Passed:

- `cd apps/web && bun run test src/queuedTurnStore.test.ts`
- `cd apps/web && bun run test:browser src/components/ChatView.browser.tsx`
- `cd apps/web && bun run test:browser src/components/QueuedTurnBackgroundDispatcher.browser.tsx`
- `bun run fmt`
- `bun run lint`
- `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && bun run typecheck`

Key added coverage:

- active-thread queued turns do not drain on a harmless ready-session refresh
- active-thread queued turns auto-pause on an idle session error
- unit coverage for the new auto-pause helper
