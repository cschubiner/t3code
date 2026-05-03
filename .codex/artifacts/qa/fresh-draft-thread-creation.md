# Fresh Draft Thread Creation QA

Date: 2026-04-06

## Repro

Observed behavior:

- `chat.new` / the sidebar `New thread` button reused the existing draft thread for the same project.
- if that existing draft was already creating a worktree or sending its first turn, trying to open another new thread kept dropping the user back onto the same draft instead of creating a fresh one.
- from the user's perspective, this made rapid `cmd+n`, send, `cmd+n`, send flows feel blocked by the earlier draft's worktree/session setup.

Red coverage added:

- `apps/web/src/components/ChatView.browser.tsx`
  - `creates a fresh draft instead of reusing the existing project draft thread`
  - `creates and sends from a fresh draft while an earlier worktree draft is still preparing`
- `apps/web/src/composerDraftStore.test.ts`
  - `keeps older draft threads when remapping a project to a new draft thread`

## Fix

Changed `useHandleNewThread` so `chat.new` always creates a fresh local draft thread instead of reusing the current project's mapped draft.

Changed `setProjectDraftThreadId(...)` so remapping a project to a newer draft no longer deletes the older draft thread and its composer content immediately. That preserves in-flight draft state until normal promotion/materialization cleanup runs.

Files changed:

- `apps/web/src/hooks/useHandleNewThread.ts`
- `apps/web/src/composerDraftStore.ts`
- `apps/web/src/composerDraftStore.test.ts`
- `apps/web/src/components/ChatView.browser.tsx`

## Validation

Passed:

- `cd apps/web && bun run test src/composerDraftStore.test.ts`
- `cd apps/web && bun run test:browser src/components/ChatView.browser.tsx`
- `bun run fmt`
- `bun run lint`
- `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && bun run typecheck`

## Remaining Note

The later report that an already-existing server thread can still show an enabled-looking send button that does nothing appears to be a separate silent-submit issue. I have not reproduced that second case in red coverage yet, so this QA artifact only covers the fresh-draft / multiple-new-thread blocker above.
