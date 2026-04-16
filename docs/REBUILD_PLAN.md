# Fork-Feature Rebuild Plan (post 2026-04-16 upstream sync)

This document tracks the fork-only features that were **intentionally skipped** during the 2026-04-16 upstream sync (PR #112) so they could be rebuilt cleanly atop upstream's current infrastructure.

The sync replayed 5 compatible commits (toolchain guardrails + Codex auth refresh + tests) and force-flipped `origin/main` to `upstream/main`. Pre-flip state is preserved on `backup/origin-main-2026-04-16`.

## Why we skipped instead of cherry-picking

Fork's infrastructure diverged heavily from upstream's:

| Fork concept | Upstream replacement | Impact |
|---|---|---|
| `NativeApi` (single global API) | `EnvironmentApi` per-`environmentId` via `readEnvironmentApi()` | Every `api.orchestration.dispatchCommand` call site needs rewrite |
| `AppStore.{projects,threads}` (arrays on root) | `AppState.{projects,threads,sidebarThreadsById,threadIdsByProjectId}` | Store access patterns changed |
| `Thread` (no `environmentId` field) | `Thread.environmentId` required | Every thread construction site needs updating |
| `getIsomorphicStorage()` | `resolveStorage()` / `createMemoryStorage()` | Storage-dependent modules need adapting |
| fork's `wsNativeApi.ts` | upstream's `rpc/wsRpcClient.ts` | Different RPC client shape |
| `.makeUnsafe()` on branded types | `.make()` | Simple find/replace |
| fork's `threadActivityStore` | activities are on `thread.activities` directly | Direct access, no separate store |

## Features to rebuild

Ordered by ascending scope. Commit each to its own PR for isolated review and QA.

### 1. ClayCode rebrand (smallest, ~1 hour)

**Goal:** Rename T3 Code (Dev)/(Alpha) back to ClayCode throughout desktop app.

**Files:**
- `apps/desktop/scripts/electron-launcher.mjs` — replace `T3 Code (Dev)` / `T3 Code (Alpha)` with `ClayCode (Dev)` / `ClayCode (Alpha)`. Keep upstream's per-env bundle IDs.
- `apps/desktop/src/main.ts` — fork had pre-upstream rebrand; upstream added `resolveDesktopAppBranding()` helper. Change the default branding names returned by the helper.
- `package.json` (desktop) — `productName`, `description` tweaks as needed.

**References:**
- Upstream rebrand helper: `apps/desktop/src/main.ts` (search `resolveDesktopAppBranding`)
- Fork pre-rebrand state: `git show backup/origin-main-2026-04-16:apps/desktop/scripts/electron-launcher.mjs`

**QA:**
- `bun fmt && bun lint && bun typecheck`
- `bun run build:desktop` (confirms electron-builder picks up new names)
- Run the built app and verify menu bar / window title / about dialog show `ClayCode`

### 2. Sidebar history keyboard shortcuts (~1 hour)

**Goal:** Bind `cmd+[` / `cmd+]` to `window.history.back()` / `window.history.forward()`.

**Files:**
- `apps/web/src/components/Sidebar.tsx` — fork added shortcut handlers around `sidebar.history.previous` / `sidebar.history.next`. On upstream, find the existing shortcuts registry (search for `shortcuts` / `useHotkey` / `useKeyboardShortcut`) and append the two new bindings.

**References:**
- Upstream shortcut plumbing: `git grep -nE "useHotkey|registerShortcut|KeyboardShortcut" apps/web/src/`
- Fork shortcut IDs: `git show backup/origin-main-2026-04-16:apps/web/src/components/Sidebar.tsx | grep -n 'sidebar.history'`

**QA:** load app, hit cmd+[ / cmd+] in multiple threads; confirm router back/forward works.

### 3. Snippet picker (~3-4 hours)

**Goal:** Restore `SnippetPickerDialog` + snippets CRUD UI backed by DB.

**Files (fork-only, need recreation against upstream API):**
- `apps/server/src/persistence/Migrations/027_Snippets.ts` (renumber from fork's 018)
- Register in `apps/server/src/persistence/Migrations.ts`
- Snippets domain: server-side query layer in `apps/server/src/persistence/Layers/`
- Client: `apps/web/src/components/SnippetPickerDialog.tsx` (+ `.browser.tsx`)
- Add "insert snippet" affordance in composer
- Add "save as snippet" in QueuedFollowUpsPanel row actions (depends on Queue+Steer #8)

**QA:** Create, edit, delete snippets; insert into composer; filter list.

### 4. Quick thread search (~3-4 hours)

**Goal:** `cmd+k` (or equivalent) opens a quick-search modal ranking threads by fuzzy title/content match.

**Files:**
- `apps/web/src/components/QuickThreadSearch.tsx` (new)
- `packages/shared/src/searchRanking` — may already be in upstream; confirm with `grep -r searchRanking packages/shared/`
- Modal-open hotkey wired in a root provider or `_chat.tsx`

**QA:** cmd+k opens modal; typing filters threads across all projects; enter navigates.

### 5. Draft threads (~4-6 hours)

**Goal:** Allow composing a thread pre-send; persist draft state; show in sidebar.

**Files:**
- Client store: draft state keyed by synthetic draft ID
- Sidebar rendering to show drafts above real threads
- Promote-to-thread flow when user hits Send
- Likely reuses composer plumbing; check fork's diff for integration points

**Backup reference:** `git log backup/origin-main-2026-04-16 --oneline -- 'apps/web/src/**draft**'`

**QA:** Create draft; it persists across reload; edits don't race; Send promotes to real thread.

### 6. GitHub PR pills (~4-6 hours)

**Goal:** Sidebar shows a pill next to each thread linked to a PR with live status (open / merged / closed).

**Files:**
- `apps/server/src/http.ts` — server route fetching PR status via `gh` CLI or GitHub API (fork had `githubPullRequestStatusRouteLayer`)
- `apps/server/src/git/Layers/GitManager.ts` — `normalizeGitHubPullRequestReference` helper (fork had this)
- `apps/web/src/components/Sidebar.tsx` — pill rendering per thread
- `packages/shared/src/githubPullRequest` — shared parsing/types
- `packages/shared/package.json` — add `githubPullRequest` to exports

**QA:** Thread with linked PR shows pill with correct status color; status refreshes on interval.

### 7. Queue + Steer (~6-10 hours) — the marquee feature

**Goal:** Queued-follow-ups panel above composer; user can queue multiple messages, reorder them, pause/resume auto-dispatch.

**Design outline:**

**New files (port-with-rewrite from backup):**
- `apps/web/src/queuedTurnStore.ts` — Zustand store. Remove `LocalDispatchSnapshotSchema` dependency (inline a local schema, or drop dispatch-state persistence). Adapt storage from `getIsomorphicStorage()` → `resolveStorage()` + `createDebouncedStorage()`.
- `apps/web/src/queuedTurnEngine.ts` — Pure. Reuse upstream's `derivePhase`, `derivePendingApprovals`, `derivePendingUserInputs`, `isLatestTurnSettled` from `apps/web/src/session-logic.ts`.
- `apps/web/src/queuedTurnDispatch.ts` — **Rewrite** against `readEnvironmentApi(environmentId).orchestration.dispatchCommand({ type: "thread.turn.start", ... })`.
- `apps/web/src/components/QueuedFollowUpsPanel.tsx` — Port mostly as-is (UI self-contained). Adjust prop types to match new queue store shape.
- `apps/web/src/components/QueuedTurnBackgroundDispatcher.tsx` — **Rewrite** against upstream `AppStore.threads` array (iterate over threads, check each via engine, auto-dispatch).

**DB migrations (new numbers):**
- `apps/server/src/persistence/Migrations/025_ProjectionThreadQueuedTurns.ts`
- `apps/server/src/persistence/Migrations/026_ProjectionThreadQueuedTurnSortOrder.ts`
- Register both in `apps/server/src/persistence/Migrations.ts`

**Integration:**
- `apps/web/src/components/ChatView.tsx` onSend (~line 2336): before the existing `api.orchestration.dispatchCommand(...)`, add a `shouldEnqueueComposerTurn()` check — if another turn is in-flight or queue already has items, push to queue instead. Else fall through to direct send.
- `apps/web/src/components/ChatView.tsx` just above the composer form (search for `ComposerPromptEditor`): mount `<QueuedFollowUpsPanel ... />` wired to the store.
- `apps/web/src/routes/_chat.tsx`: mount `<QueuedTurnBackgroundDispatcher />` once at the chat route level.

**Use upstream helpers (don't port fork's versions):**
- `createLocalDispatchSnapshot` (already in `apps/web/src/components/ChatView.logic.ts` line 295) — note: upstream's shape differs from fork's (no `threadId` / `sessionActiveTurnId` fields).
- `hasServerAcknowledgedLocalDispatch` (already in `apps/web/src/components/ChatView.logic.ts` line 313)

**Contract compat:**
- Fork's queue uses client-side-only types; upstream's `ClientThreadTurnStartCommand` expects `UploadChatAttachment` (dataUrl-based). Dispatch helper must convert queued `QueuedTurnAttachment` → `UploadChatAttachment` at send time.

**Known incompat hazards:**
- Fork's `Thread` type has no `environmentId` — upstream requires it. Tests and fixtures must be updated.
- Fork's `AppStore` had `threads` and `projects` as root keys — upstream does too but shape/contents differ (confirm with `apps/web/src/types.ts`).
- Fork's `useThreadById` may not exist upstream — use `useAppStore((s) => s.threads.find((t) => t.id === id))` or whatever selector exists.

**QA:**
- Queue 3 messages; confirm they appear in panel
- Drag reorder; confirm order persists across reload
- First message sends; observe server acks; next auto-dispatches
- Pause queue; new messages stop dispatching; resume works
- Session error pauses queue automatically
- Pending approval/user-input pauses queue until resolved

### 8. Tailscale remote access (~6-10 hours)

**Goal:** Desktop app discovers Tailscale network; exposes dev server on Tailnet IP; user can access UI from other Tailscale-connected devices.

**Files:**
- `apps/desktop/scripts/electron-launcher.mjs` — Tailscale binary discovery
- `apps/desktop/src/main.ts` — network interface selection
- `apps/server/src/http.ts` — listen on Tailnet IP as well as localhost
- UI indicator showing Tailnet URL for sharing

**Prior art:** `git log backup/origin-main-2026-04-16 --oneline --grep=-i tailscale`

**Hazards:**
- Upstream added `wsTransport.ts` refactor that deleted the file fork's Tailscale commit referenced — expect integration rewrite.

**QA:** Desktop app shows Tailnet URL; accessing it from phone on Tailscale loads UI.

## Session execution rhythm

For each feature above:

1. `git switch -c feature/<name> origin/main` (fresh branch off latest main)
2. Implement
3. `bun fmt && bun lint && bun typecheck && bun run test`
4. Commit, push, open PR
5. Manual QA (build + run + exercise feature)
6. Iterate on review feedback
7. Merge to main
8. Next feature

## Deferred (not rebuilding)

- **Fork's WS RPC client (`wsNativeApi`, `wsRpcClient`)** — upstream has its own better version at `apps/web/src/rpc/wsRpcClient.ts`. No action needed.
- **Provider status cache** — implementation detail of fork's Codex provider; upstream's provider has its own status management already.

## Artifacts preserved

- `backup/origin-main-2026-04-16` — pre-flip fork main (contains all skipped commits)
- `replay/fork-onto-upstream-2026-04-16` — the merged replay branch
- PR #112 (merged) — the sync PR with commit-level decision log
