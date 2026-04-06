# Send And Draft Thread Availability QA

Date: 2026-04-06
Worktree: `/Users/canal/.codex/worktrees/f606/t3code`

## Problems reproduced

### 1. `chat.new` could strand users on a reused draft thread

Observed behavior:

- Starting a new draft thread for a project, sending the first prompt, then pressing `cmd+n` again could route back into the same project draft instead of creating a fresh draft.
- If the first draft was still preparing a worktree or first turn, the user could not rapidly create and send from multiple fresh drafts in parallel.

Red coverage:

- `apps/web/src/components/ChatView.browser.tsx`
  - `creates a fresh draft instead of reusing the existing project draft thread`
  - `creates and sends from a fresh draft while an earlier worktree draft is still preparing`

Root cause:

- `useHandleNewThread` reused the existing project draft thread.
- `composerDraftStore.setProjectDraftThreadId` also deleted the older draft/composer state when remapping the project to a new draft thread.

Fix:

- `apps/web/src/hooks/useHandleNewThread.ts`
  - Always creates a fresh draft thread id for `chat.new`.
- `apps/web/src/composerDraftStore.ts`
  - Preserves older draft thread/composer state when a project is remapped to a new draft thread.

### 2. Existing-thread sends could silently no-op under a generic Codex provider error banner

Observed behavior:

- In an existing thread, the send button could appear available and the composer had content, but clicking send or pressing `Enter` did nothing.
- This matched cases where the UI was showing a generic Codex provider error banner such as:
  - `Codex CLI is installed but failed to run. Timed out while running command.`

Red coverage:

- `apps/web/src/components/ChatView.browser.tsx`
  - `does not let a generic codex provider error banner block a fresh send from an existing thread`
  - `does not let Enter get blocked by a generic codex provider error banner`

Root cause:

- `ChatView` had a hidden `onSend` early-return for generic provider errors.
- The primary send button enablement logic did not reflect that same block, so the UI could look sendable while `onSend` silently returned.

Fix:

- `apps/web/src/components/ChatView.tsx`
  - Removed the generic provider-error send block from `onSend`.
  - The provider banner still renders, but it no longer prevents a fresh turn from being sent.

## Verification

Executed successfully:

- `cd apps/web && bun run test:browser src/components/ChatView.browser.tsx`
- `cd apps/web && bun run test:browser src/components/chat/ComposerPrimaryActions.browser.tsx`
- `cd apps/web && bun run test src/composerDraftStore.test.ts`
- `bun run fmt`
- `bun run lint`
- `export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH" && bun run typecheck`

Results:

- `ChatView.browser.tsx`: `66 passed`
- `ComposerPrimaryActions.browser.tsx`: `3 passed`
- `composerDraftStore.test.ts`: `50 passed`
- `fmt`, `lint`, and `typecheck`: passed

## Notes

- The two user-visible symptoms looked similar but came from different causes.
- The branch toolbar auto-selects the current git branch for new worktree drafts, so worktree drafts are not expected to remain branch-less for long in the real UI.
- The new browser coverage protects the fresh-draft parallel-start path, the generic provider-error silent-send path, and the structurally-unavailable send state so future regressions should be easier to catch.
