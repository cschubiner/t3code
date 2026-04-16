# Fork-Feature Rebuild Plan (post 2026-04-16 upstream sync)

This document tracks the fork-only features that were **intentionally skipped** during the 2026-04-16 upstream sync (PR #112) so they could be rebuilt cleanly atop upstream's current infrastructure.

The sync replayed 5 compatible commits (toolchain guardrails + Codex auth refresh + tests) and force-flipped `origin/main` to `upstream/main`. Pre-flip state is preserved on `backup/origin-main-2026-04-16`.

## Status (last updated 2026-04-16)

| # | Feature | Status | Commit / Notes |
|---|---|---|---|
| 1 | ClayCode rebrand | ✅ Done | `deae3a16` (PR #113 merged) |
| 2 | Sidebar history shortcuts (cmd+[/]) | ✅ Done | `4a9908cd` |
| 3a | Snippet picker — server + contracts | ✅ Done | `707ae121` |
| 3b | Snippet picker — client (dialog + RPC + react-query) | ✅ Done | `b181fc3d` (composer "insert snippet" trigger deferred) |
| 4 | Tailscale remote access — module | ✅ Module + tests | `1dc09a52` (full Electron lifecycle integration deferred) |
| 5 | Quick thread search | ⏸ Deferred | Fork files require `AppStore.threads/projects` (now `sidebarThreadsById/threadIdsByProjectId`) and router params `/$threadId` (now `/$environmentId/$threadId`) — needs rework |
| 6 | PR pills | ✅ Already in upstream | Sidebar already has `prStatusIndicator` + `openPrLink` |
| 7 | Draft threads | ✅ Already in upstream | `composerDraftStore` has `DraftThreadState` + `/draft/$draftId` route |
| 8 | Queue + Steer | ⏸ Deferred | See section 7 below — multi-hour rework |

**Net for this sync session:** 5 features shipped to main, 2 already present in upstream, 2 deferred for focused follow-up sessions.

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

**Feature-specific QA (in addition to universal gate):**

Visual / brand audit
- [ ] macOS menu bar shows `ClayCode (Dev)` / `ClayCode (Alpha)` per env
- [ ] Window title bar correct
- [ ] About dialog (`ClayCode → About`) shows correct name + version
- [ ] Dock icon tooltip correct
- [ ] cmd+Tab app switcher label correct
- [ ] Notification banner (when app sends one) shows correct sender name
- [ ] Spotlight search finds the app under the new name
- [ ] `Get Info` in Finder on the `.app` bundle shows correct `CFBundleName`

Bundle / install integrity
- [ ] Bundle ID is still upstream's per-env scheme (don't regress to fork's single ID — would clash with upstream installs)
- [ ] Auto-updater feed URL still resolves correctly (rebrand should not change update channel)
- [ ] Existing installed app with old name does not double-install — confirm Squirrel/electron-updater honors bundle ID for upgrades
- [ ] Code-signing passes (`codesign --verify --deep --strict --verbose=2 <Path.app>`)

Cross-platform (if applicable)
- [ ] Linux `.AppImage` shows correct `Name=` in `.desktop` file
- [ ] Windows `.exe` shows correct `ProductName` in file properties
- [ ] Squirrel.Windows install/uninstall uses correct shortcut name

Regression
- [ ] All existing keyboard shortcuts still work (cmd+N, cmd+W, cmd+Q, etc.)
- [ ] Deep links (if any) still resolve
- [ ] Restart the app — settings persist, doesn't show first-run wizard

### 2. Sidebar history keyboard shortcuts (~1 hour)

**Goal:** Bind `cmd+[` / `cmd+]` to `window.history.back()` / `window.history.forward()`.

**Files:**
- `apps/web/src/components/Sidebar.tsx` — fork added shortcut handlers around `sidebar.history.previous` / `sidebar.history.next`. On upstream, find the existing shortcuts registry (search for `shortcuts` / `useHotkey` / `useKeyboardShortcut`) and append the two new bindings.

**References:**
- Upstream shortcut plumbing: `git grep -nE "useHotkey|registerShortcut|KeyboardShortcut" apps/web/src/`
- Fork shortcut IDs: `git show backup/origin-main-2026-04-16:apps/web/src/components/Sidebar.tsx | grep -n 'sidebar.history'`

**Feature-specific QA (in addition to universal gate):**

Behavior
- [ ] cmd+[ navigates back, cmd+] navigates forward — verify across at least 5 navigation steps
- [ ] Shortcuts work from inside threads, sidebar, settings, modals
- [ ] Shortcuts do **not** fire when focus is in a text input / textarea / contenteditable (don't hijack typing)
- [ ] Shortcuts do **not** fire when focus is in the composer (cmd+[ in composer should not navigate)
- [ ] When at the start of history, cmd+[ is a no-op (or shows visual indication) — does not crash
- [ ] When at the end of history, cmd+] is a no-op
- [ ] Shortcuts persist across hard reload (re-register on mount)

Conflict checks
- [ ] No conflict with browser-native cmd+[ / cmd+] (they should be intercepted)
- [ ] No conflict with composer-internal shortcuts (e.g., outdent in code editor)
- [ ] No conflict with terminal pane shortcuts
- [ ] cmd+shift+[ / cmd+shift+] (tab navigation in some apps) still works correctly if used elsewhere

Regression
- [ ] Other keyboard shortcuts unaffected (cmd+N new thread, cmd+K command palette, etc.)
- [ ] Sidebar collapse/expand state preserved across navigation

Cross-platform
- [ ] On Linux/Windows, ctrl+[ / ctrl+] equivalent works (verify keymap binding uses platform-correct modifier)

### 3. Snippet picker (~3-4 hours)

**Goal:** Restore `SnippetPickerDialog` + snippets CRUD UI backed by DB.

**Files (fork-only, need recreation against upstream API):**
- `apps/server/src/persistence/Migrations/027_Snippets.ts` (renumber from fork's 018)
- Register in `apps/server/src/persistence/Migrations.ts`
- Snippets domain: server-side query layer in `apps/server/src/persistence/Layers/`
- Client: `apps/web/src/components/SnippetPickerDialog.tsx` (+ `.browser.tsx`)
- Add "insert snippet" affordance in composer
- Add "save as snippet" in QueuedFollowUpsPanel row actions (depends on Queue+Steer #8)

**Feature-specific QA (in addition to universal gate):**

CRUD happy path
- [ ] Create snippet from scratch — appears in list immediately
- [ ] Create snippet from "Save as snippet" affordance in QueuedFollowUpsPanel (when Queue+Steer is built)
- [ ] Edit snippet — changes persist across reload
- [ ] Delete snippet — confirms removal, gone from list
- [ ] Snippet list orders consistently (alphabetical or recently-used; pick one and verify)

Insertion behavior
- [ ] Insert snippet into empty composer — text appears, cursor at end
- [ ] Insert snippet into mid-text composer — text inserts at cursor, doesn't replace
- [ ] Insert snippet with multiline content — newlines preserved
- [ ] Insert snippet with special chars (markdown, backticks, emojis) — encoding preserved

Filter / search
- [ ] Type in filter — list narrows incrementally
- [ ] Empty filter — full list returns
- [ ] No-match filter — empty state with clear messaging
- [ ] Filter is case-insensitive
- [ ] Filter is debounced (no flicker on fast typing)

Modal / dialog UX
- [ ] Esc closes dialog without saving
- [ ] Click-outside closes dialog
- [ ] Cmd+Enter in edit form saves
- [ ] Focus moves into dialog on open, returns to trigger on close
- [ ] Dialog is responsive (mobile-width viewport doesn't break layout)

Persistence / migration
- [ ] Snippets survive page reload (DB-backed)
- [ ] Snippets survive server restart
- [ ] Migration test: legacy DB without `snippets` table → migrate → empty snippets list, no crash
- [ ] Inspect SQLite file with `sqlite3` CLI to confirm schema correct
- [ ] Snippets are scoped correctly (per-project? per-user? document the choice and verify)

Edge cases
- [ ] Snippet with empty title — rejected with clear error
- [ ] Snippet with 10KB body — saves and loads correctly
- [ ] 100 snippets in list — UI stays responsive (consider virtualization)
- [ ] Two clients adding snippets simultaneously — no key collision, both persist

Regression
- [ ] Composer drafts still persist correctly
- [ ] No new console errors when opening picker

### 4. Quick thread search (~3-4 hours)

**Goal:** `cmd+k` (or equivalent) opens a quick-search modal ranking threads by fuzzy title/content match.

**Files:**
- `apps/web/src/components/QuickThreadSearch.tsx` (new)
- `packages/shared/src/searchRanking` — may already be in upstream; confirm with `grep -r searchRanking packages/shared/`
- Modal-open hotkey wired in a root provider or `_chat.tsx`

**Feature-specific QA (in addition to universal gate):**

Open / close
- [ ] cmd+k (or chosen hotkey) opens modal from anywhere in app
- [ ] Esc closes modal
- [ ] Click outside closes modal
- [ ] Modal restores focus to previously-focused element on close
- [ ] Modal is centered + sized appropriately at mobile / tablet / desktop widths

Search behavior
- [ ] Empty input shows recent threads (or top-N) — document and verify
- [ ] Type one char — list filters; further chars narrow further
- [ ] Backspace widens results
- [ ] Search matches across thread title (and body if scoped)
- [ ] Search is fuzzy (substring + typo-tolerant per searchRanking)
- [ ] Ranking puts most-recent / most-active threads first when scores tie
- [ ] Diacritics / unicode handled (search "café" matches "cafe"? document and verify)
- [ ] Special chars in query don't break (`*`, `\`, `'`, `"`)

Navigation
- [ ] Arrow up/down moves selection
- [ ] Enter navigates to selected thread, modal closes
- [ ] Click navigates same as Enter
- [ ] After navigation, sidebar selection updates to new thread
- [ ] Navigation works across project boundaries (search in project A, navigate to project B's thread, project context updates)

Performance
- [ ] 1000 threads — open + type stays under 100ms perceived latency
- [ ] Typing fast does not stutter (debounced rendering or virtualization)
- [ ] Memory does not balloon when modal opens repeatedly

Regression
- [ ] cmd+K does not collide with composer paste-image shortcut or terminal shortcut
- [ ] Other hotkeys still work
- [ ] Sidebar still navigable normally after using quick search

Persistence
- [ ] Recent searches saved between sessions (or document explicit decision not to)
- [ ] Search index rebuilds correctly when threads added/removed/renamed

### 5. Draft threads (~4-6 hours)

**Goal:** Allow composing a thread pre-send; persist draft state; show in sidebar.

**Files:**
- Client store: draft state keyed by synthetic draft ID
- Sidebar rendering to show drafts above real threads
- Promote-to-thread flow when user hits Send
- Likely reuses composer plumbing; check fork's diff for integration points

**Backup reference:** `git log backup/origin-main-2026-04-16 --oneline -- 'apps/web/src/**draft**'`

**Feature-specific QA (in addition to universal gate):**

Lifecycle
- [ ] "New draft" affordance creates draft visible in sidebar
- [ ] Multiple drafts coexist — each has independent state
- [ ] Editing a draft persists (debounced to localStorage and/or server)
- [ ] Draft survives hard reload
- [ ] Draft survives server restart (if server-backed) or localStorage clear shows graceful degradation
- [ ] Hitting Send promotes draft to real thread; sidebar entry updates from "draft" styling to normal
- [ ] Promoted thread retains all draft content (text, attachments, model selection)
- [ ] Discard draft removes it from sidebar + storage

Sidebar treatment
- [ ] Drafts visually distinct from real threads (italic? badge? document the convention)
- [ ] Drafts ordered consistently (top? grouped section? document)
- [ ] Selecting a draft loads its composer state (not blank composer)
- [ ] Drafts respect per-project scoping

Concurrent edits
- [ ] Open draft in two tabs — last-write-wins or conflict UX (document the choice and verify)
- [ ] Switching threads while typing in draft saves intermediate state

Edge cases
- [ ] Draft with no text but attachment — Send works
- [ ] Draft with text + 5 attachments — promotes correctly
- [ ] Draft created on a now-deleted project — graceful error / cleanup
- [ ] 50 drafts — sidebar still performant

Regression
- [ ] Real threads still create normally (Send from a fresh non-draft path works)
- [ ] Composer drafts (per-thread persistent text) still work in real threads
- [ ] No localStorage key collision with `composerDraftStore` or `queuedTurnStore`

### 6. GitHub PR pills (~4-6 hours)

**Goal:** Sidebar shows a pill next to each thread linked to a PR with live status (open / merged / closed).

**Files:**
- `apps/server/src/http.ts` — server route fetching PR status via `gh` CLI or GitHub API (fork had `githubPullRequestStatusRouteLayer`)
- `apps/server/src/git/Layers/GitManager.ts` — `normalizeGitHubPullRequestReference` helper (fork had this)
- `apps/web/src/components/Sidebar.tsx` — pill rendering per thread
- `packages/shared/src/githubPullRequest` — shared parsing/types
- `packages/shared/package.json` — add `githubPullRequest` to exports

**Feature-specific QA (in addition to universal gate):**

Status accuracy
- [ ] Open PR → green "open" pill
- [ ] Merged PR → purple "merged" pill
- [ ] Closed (not merged) PR → red/grey "closed" pill
- [ ] Draft PR → grey "draft" pill (if drafts supported)
- [ ] PR with failing CI → status reflects (or separate indicator)
- [ ] PR with pending review → reflects review status
- [ ] PR that doesn't exist (deleted/wrong number) → graceful error pill, not crash

Refresh behavior
- [ ] Status auto-refreshes on a documented interval (e.g., 60s)
- [ ] Manual refresh affordance (right-click? button?) — works
- [ ] Status update on focus (window regains focus after switching apps)
- [ ] No refresh storm when many threads open simultaneously
- [ ] Backoff on rate-limit errors — does not hammer GitHub API

Auth / network
- [ ] Without `gh auth` configured → pill shows "auth required" + clear remediation copy
- [ ] With expired `gh` token → graceful re-auth prompt, not silent failure
- [ ] Network offline → cached status shown with "stale" indicator
- [ ] Private repos still work with proper auth
- [ ] GitHub Enterprise (if supported) — works with custom host

PR detection
- [ ] Thread linked to a PR via branch name → auto-detected
- [ ] Thread linked via explicit URL paste in description/title → detected
- [ ] Thread with no linked PR → no pill rendered (no empty space leak)
- [ ] Multiple PRs for one thread → handles (show most recent or all? document)

Sidebar layout
- [ ] Pill renders at consistent location per thread row
- [ ] Pill truncation handled at narrow sidebar widths
- [ ] Hover shows full PR title + number tooltip
- [ ] Click navigates to PR in browser (or shows menu of options)

Performance
- [ ] 100 threads with PRs — sidebar render stays under 16ms per frame
- [ ] PR status fetches batched / parallelized, not serial

Regression
- [ ] Sidebar still works for threads without PRs
- [ ] Thread renaming / deletion still works
- [ ] Server doesn't leak GitHub tokens in any log path

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

**Feature-specific QA (in addition to universal gate):**

Enqueue / display
- [ ] First message in idle thread → sends immediately, NOT enqueued (queue only kicks in when busy)
- [ ] Message during in-flight turn → enqueues, panel appears with item
- [ ] Queue 5 messages → all 5 visible in panel in order
- [ ] Each item shows: index badge, "Next" indicator on first, interaction mode tag, image count
- [ ] Long message text truncates at the documented limit (72 chars?) with ellipsis + tooltip
- [ ] Messages with images show count badge
- [ ] Messages with terminal context show context badge

Reorder / edit
- [ ] Drag item up — order updates, animation smooth
- [ ] Drag item down — order updates
- [ ] Drag item to same position — no-op, no flicker
- [ ] Edit row → inline editor opens with current text
- [ ] Save edit → text updates, item stays in place
- [ ] Cancel edit (Esc) → reverts unsaved changes
- [ ] Delete row → item removed, others reindex
- [ ] Send Now on a row → item dispatched immediately (jumps the queue)
- [ ] Clear All → confirms then empties queue

Auto-dispatch sequencing
- [ ] First turn completes → next queued auto-dispatches within 1s
- [ ] Engine respects local-dispatch ack: doesn't fire next until server confirms previous
- [ ] No double-dispatch if React re-renders during ack window
- [ ] Server-side ordering matches client queue order (verify in server logs)
- [ ] Last message dispatches and queue empties cleanly

Pause / resume
- [ ] Manual Pause → "Paused" banner appears, no auto-dispatch
- [ ] Resume → next item dispatches (if eligible)
- [ ] Pause persists across reload
- [ ] Resume after error clears pause reason

Auto-pause triggers
- [ ] Pending approval appears → queue auto-pauses with `pending-approval` reason
- [ ] Approve → queue resumes
- [ ] Reject → queue stays paused (or resumes? document)
- [ ] Pending user-input → auto-pauses with `pending-user-input`
- [ ] Resolve user-input → resumes
- [ ] Session error → auto-pauses with `session-error`
- [ ] Session interrupted → auto-pauses with `session-interrupted`
- [ ] Thread error → auto-pauses with `thread-error`

Block reasons (transient, not paused)
- [ ] Session connecting → block reason "connecting", auto-resumes when ready
- [ ] Session running → block reason "running"
- [ ] Local dispatch in flight → block reason "local-dispatch"
- [ ] All three render distinct status copy in panel

Persistence
- [ ] Reload mid-queue → items + pause state restored from localStorage
- [ ] Items survive across browser restart (not just reload)
- [ ] Storage key versioning: simulate v1 legacy data → migrates to v2 cleanly without data loss
- [ ] Clear localStorage → queue empties, no crash
- [ ] Two tabs open same project → both see same queue (or document last-write-wins behavior)

DB-side correctness (migrations 025/026)
- [ ] Fresh DB → migrate → `projection_thread_queued_turns` table exists with correct schema
- [ ] Existing DB → migrate → no data corruption, no queue table conflict
- [ ] Drop table, re-migrate → clean state
- [ ] `sort_order` column populated correctly for backfilled rows
- [ ] Index on `(thread_id, sort_order, queued_at)` exists and used (verify with EXPLAIN QUERY PLAN)

Edge cases
- [ ] Queue 50 items → UI stays responsive, drag still works
- [ ] Queue with attachments totaling 50MB → memory does not balloon (lazy load thumbnails)
- [ ] Queue across thread switch → items stay scoped to original thread, don't leak
- [ ] Delete the active thread while queue has items → graceful cleanup, no orphaned items
- [ ] Network disconnect mid-dispatch → engine retries on reconnect, doesn't double-send
- [ ] Server crash mid-dispatch → on restart, queue state recoverable

Steering integration (if part of this feature)
- [ ] User can interrupt running turn → queue pauses
- [ ] User can re-prioritize a queued item via Send Now
- [ ] Plan mode + queue → interaction mode preserved per item

Concurrent ops
- [ ] Two browser tabs queueing into same thread → no duplicate dispatch
- [ ] Server receives single ack stream — verify in server logs

Regression
- [ ] Single-message send (no queue) still works exactly as before
- [ ] Composer drafts unaffected
- [ ] Snippet picker (when built) integrates: "Save as snippet" from queue row works
- [ ] Thread archival / deletion works for thread with queued items
- [ ] No new console warnings or errors during normal use
- [ ] Existing `ChatView.logic.test.ts` tests still pass

Telemetry
- [ ] Server logs show "queue dispatch begin" / "queue dispatch ack" with thread/turn IDs
- [ ] Client logs show queue state transitions (in dev mode)
- [ ] No PII (message text) logged at info level

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

**Feature-specific QA (in addition to universal gate):**

Discovery
- [ ] Desktop app starts on machine with Tailscale running → detects Tailscale, shows Tailnet IP/hostname
- [ ] Desktop app starts on machine with Tailscale stopped → graceful fallback (only localhost), no crash
- [ ] Tailscale not installed at all → graceful skip, clear log message
- [ ] Tailscale logged out → clear "log into Tailscale" prompt, not silent failure

Network exposure
- [ ] Server binds to Tailnet interface in addition to 127.0.0.1
- [ ] Server does NOT bind to all interfaces (0.0.0.0) — verify with `netstat -an | grep <port>`
- [ ] HTTPS / TLS handled correctly if Tailscale Funnel/Serve used
- [ ] Auth still required from remote — no auth bypass over Tailnet

Connectivity
- [ ] iPhone on same Tailnet → loads UI at Tailnet URL, full functionality
- [ ] Laptop on same Tailnet (different machine) → loads UI, full functionality
- [ ] Device not on Tailnet → connection refused (verifies network isolation)

Concurrent clients
- [ ] Local browser + remote device connected simultaneously → both see consistent state
- [ ] WebSocket multiplexing handles both connections
- [ ] Sending message from one device shows on the other in real-time
- [ ] No state divergence between clients

UI affordance
- [ ] App displays Tailnet URL prominently for easy sharing (copy button, QR code?)
- [ ] URL updates if Tailscale IP changes (e.g., new Tailnet device)
- [ ] Status indicator shows Tailscale connected / disconnected

Security
- [ ] Tailnet exposure is opt-in (default off) OR clearly disclosed at first launch
- [ ] No sensitive data leaks in URLs or query params
- [ ] CORS / origin checks still enforced for Tailnet origin

Failure modes
- [ ] Tailscale daemon stops mid-session → server keeps serving on localhost, UI shows "Tailnet disconnected" indicator
- [ ] Tailscale daemon restarts → re-detect, re-bind
- [ ] Network partition between client and server (Tailscale relay outage) → graceful UX, retry logic

Regression
- [ ] Localhost access still works exactly as before
- [ ] Single-machine flow unaffected when Tailscale not running
- [ ] Existing electron app launch / quit / reload works
- [ ] No new permission prompts on macOS (or document expected ones: e.g., network access)

Cross-platform
- [ ] macOS Tailscale detection works
- [ ] Linux Tailscale detection works
- [ ] Windows Tailscale detection works (if Windows desktop builds shipped)

## Session execution rhythm

For each feature:

1. `git switch -c feature/<name> origin/main` (fresh branch off latest main)
2. Implement
3. **Run universal QA gate (see below) — must be 100% green before opening PR**
4. Commit, push, open PR
5. **Run feature-specific QA scenarios (see per-feature sections)**
6. Iterate on review feedback
7. Re-run universal + feature QA after every change
8. Merge to main only when both QA passes are clean
9. Smoke-check `main` after merge (build, run, sanity test) before starting next feature

## Universal QA gate (every feature — non-negotiable)

This is the floor. No PR opens until all of these pass.

### Static checks

- [ ] `bun fmt` — formatting clean
- [ ] `bun lint` — 0 errors, 0 new warnings
- [ ] `bun typecheck` — 0 errors across all packages (server, web, contracts, shared, desktop)
- [ ] `bun run test` — full Vitest suite green
- [ ] No new `// eslint-disable` directives without inline justification comment
- [ ] No new `any` / `as unknown as` casts without inline justification comment
- [ ] No new `@ts-expect-error` / `@ts-ignore` without inline justification comment

### Test coverage

- [ ] **Unit tests** for every new pure function / hook / store action (in `*.test.ts`)
- [ ] **Browser tests** (`*.browser.tsx`) for every new component with interactive behavior
- [ ] **Integration test** covering at least one happy-path end-to-end flow through the new feature
- [ ] **Snapshot test** stability: no unexpected snapshot churn in unrelated files
- [ ] If feature touches server: **server-side test** in `apps/server/src/**/*.test.ts` covering the new route/handler/migration
- [ ] If feature adds DB migration: **migration `.test.ts`** verifies up/down + idempotency

### Build verification

- [ ] `bun run build` (full Turborepo build) succeeds
- [ ] `bun run build:desktop` succeeds and produces working binary on macOS (and confirm Linux/Windows builds if CI runs them)
- [ ] Bundle size delta ≤ 5% (check `.vite/build/stats` or similar). Flag larger jumps.
- [ ] No new runtime warnings in dev server console (`bun run dev`)

### DB / migration safety (when applicable)

- [ ] New migration is **append-only** (never modifies an existing migration file)
- [ ] New migration has `IF NOT EXISTS` guards on `CREATE TABLE` / `CREATE INDEX`
- [ ] Migration test covers: fresh DB → migrate → expected schema; existing DB with legacy data → migrate → no data loss
- [ ] Roll-back rehearsal: revert the PR locally, observe that DB still works (data may be inert but server must start)
- [ ] Test on a **realistic-size DB** (export your real local DB, copy to test path, run migrations, verify success)

### Cross-cutting regression checks

Run these end-to-end scenarios on a real running app **before** opening the PR. Use a fresh project (`/tmp/qa-project-N`) for each session so state is isolated.

- [ ] **Send a single message** in a fresh thread — completes normally, response renders
- [ ] **Send second message** in same thread — turn ordering correct
- [ ] **Switch threads mid-stream** — UI doesn't crash, returning to original thread shows full state
- [ ] **Switch projects** — sidebar updates, no stale data leaks across project boundaries
- [ ] **Reload page mid-stream** — server-side state recovers, client reconnects
- [ ] **Disconnect WiFi for 10s, reconnect** — websocket recovers, UI shows connection state correctly
- [ ] **Kill server (Ctrl-C)** — UI shows error state, recovers when server restarts
- [ ] **Open second browser tab on same project** — both tabs see consistent state, no duplicate sends
- [ ] **Hard reload (cmd+shift+R)** — no localStorage corruption, state rehydrates
- [ ] **Clear localStorage manually** — app degrades gracefully, no runtime errors

### Accessibility (for any UI feature)

- [ ] All interactive elements reachable by keyboard (Tab / Shift-Tab)
- [ ] Focus visible on every focusable element
- [ ] No focus traps that can't be escaped with Esc
- [ ] Buttons / inputs have accessible labels (`aria-label` or visible text)
- [ ] Color is not the only indicator of state (use icons + text)
- [ ] Modals trap focus correctly and restore on close

### Telemetry / observability (when applicable)

- [ ] Server logs show expected events for the new feature path
- [ ] Errors propagate to client with actionable messages, not opaque "internal error"
- [ ] No secrets logged (check for `process.env`, tokens, paths in log lines)

### Documentation

- [ ] User-facing behavior change → update `README.md` or relevant docs
- [ ] Internal architecture change → update `AGENTS.md` if conventions shift
- [ ] New env var or CLI flag → documented in `apps/server/src/cliArgs.ts` help text and README

## Final integration QA (after all 8 features merged)

After every feature is independently merged + QA'd, run this combined pass on `main`:

### End-to-end user journeys

- [ ] **New user first run**: launch app → onboarding → create project → start first thread → send message → response renders
- [ ] **Power user daily flow**: open app → cmd+K to find thread → resume → queue 3 follow-ups → each dispatches in order → save one as snippet → reuse snippet in another thread
- [ ] **Multi-thread juggling**: create 3 threads in 2 projects → switch between them rapidly → each maintains its own queue, drafts, and state
- [ ] **PR workflow**: create thread linked to a real PR → see pill update as PR moves through open → reviewed → merged
- [ ] **Remote access**: pair desktop on laptop with iPhone via Tailscale → continue conversation from phone

### Cross-feature interactions

- [ ] Queue + Drafts: queue items in a draft thread, then promote — items follow promotion correctly
- [ ] Queue + Snippets: insert snippet into composer while queue has items — doesn't interfere with queue
- [ ] Queue + PR pills: thread with PR pill + active queue — both render, no layout collision
- [ ] Search + Drafts: quick search finds drafts as well as real threads (or document explicit exclusion)
- [ ] Sidebar shortcuts + Search: cmd+[ does NOT close cmd+K modal (modal traps keys)
- [ ] Rebrand + everything: app shows consistent ClayCode branding across all new feature surfaces

### Performance baseline

- [ ] Cold start time within 10% of pre-rebuild baseline (measure with `time` or built-in metrics)
- [ ] Idle memory footprint unchanged
- [ ] CPU usage during typing in composer unchanged
- [ ] CPU usage during streaming response unchanged
- [ ] Bundle size delta for cumulative web app < 15%

### Data safety

- [ ] Migrate a real production-size DB (export from your daily-driver install) → all migrations succeed, no data loss
- [ ] Roll back to pre-rebuild commit → app still runs (data may show "missing feature" gracefully)
- [ ] Forward-roll again → state restored

### Documentation pass

- [ ] README updated with new features and screenshots
- [ ] CHANGELOG entry summarizing the rebuild milestone
- [ ] AGENTS.md updated if conventions changed
- [ ] Any new env vars / CLI flags documented

### Production readiness

- [ ] All builds (web, desktop) shipped through CI green for at least 3 consecutive runs (no flakes)
- [ ] No `console.log` left in production code paths
- [ ] No `TODO` / `FIXME` / `XXX` comments without an accompanying issue
- [ ] Sentry / error reporting (if configured) shows no new error classes from feature paths in 24h soak

## Deferred (not rebuilding)

- **Fork's WS RPC client (`wsNativeApi`, `wsRpcClient`)** — upstream has its own better version at `apps/web/src/rpc/wsRpcClient.ts`. No action needed.
- **Provider status cache** — implementation detail of fork's Codex provider; upstream's provider has its own status management already.

## Artifacts preserved

- `backup/origin-main-2026-04-16` — pre-flip fork main (contains all skipped commits)
- `replay/fork-onto-upstream-2026-04-16` — the merged replay branch
- PR #112 (merged) — the sync PR with commit-level decision log
