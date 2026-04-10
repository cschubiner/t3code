# Fresh Draft Send Race

Date: 2026-04-10

## Problem

During QA, sending from a brand-new local draft thread could fail in the browser with:

- `Failed to dispatch orchestration command`

At the same time, a raw `thread.turn.start` against the same thread id could succeed. That pointed to a browser-path race in the draft-thread bootstrap flow rather than a real inability to start the turn.

## Root Cause

The local-draft send path always attempted `thread.create` before `thread.turn.start`.

If the backend had already materialized that thread id, but the browser was still looking at the local draft representation, `thread.create` could lose the race and fail before the real send was attempted.

## Fix

- Web: when `thread.create` fails for a local draft send, the client now checks the latest server snapshot for that thread id.
- If the server already has the thread, the send path recovers and proceeds with the normal first-turn flow instead of surfacing a fatal browser error.
- Server: the WebSocket RPC layer now preserves specific dispatch error messages instead of collapsing them into a generic `Failed to dispatch orchestration command`.

## Regression Coverage

- `apps/web/src/components/ChatView.browser.tsx`
  - `continues sending from a local draft when thread.create loses a stale materialization race`
- `apps/web/src/components/ChatView.logic.test.ts`
  - duplicate-thread-create detection
- `apps/server/src/ws.test.ts`
  - specific dispatch messages are preserved

## Verification

- `cd apps/server && bun run test src/ws.test.ts`
- `cd apps/web && bun run test src/components/ChatView.logic.test.ts`
- `cd apps/web && bun run test:browser src/components/ChatView.browser.tsx -t "continues sending from a local draft when thread.create loses a stale materialization race"`
