# T3 Code - Claude Code Instructions

## Building & Running the Desktop App

### Quick start (from the main worktree)

```bash
# The main branch is checked out in a worktree:
cd ~/.t3/worktrees/t3code/t3code-78867535

# 1. Full build (contracts, server, web, desktop)
bun run build

# 2. Launch Electron — MUST cd into apps/desktop first
cd apps/desktop
nohup ./node_modules/.bin/electron dist-electron/main.mjs > /tmp/t3code-electron.log 2>&1 &
```

### Important notes

- The Electron binary lives at `apps/desktop/node_modules/.bin/electron`
- The built entry is `apps/desktop/dist-electron/main.mjs` (ESM, not .js)
- You MUST `cd apps/desktop` before launching, or Electron can't resolve the entry
- The build output goes to the worktree, NOT the primary repo at ~/t3code
- User data (DB, keybindings, state) is stored in `~/.t3/userdata/`

### Desktop-only rebuild (faster iteration)

```bash
bun run --cwd apps/desktop build
```

### Killing the app

```bash
pkill -f "Electron.*dist-electron"
```

### Checking logs

```bash
tail -f /tmp/t3code-electron.log
```

## Worktrees

The main branch is checked out in a worktree at `~/.t3/worktrees/t3code/t3code-*`. If `git checkout main` fails with "already used by worktree", operate on main via that worktree path instead. The primary repo at `~/t3code` is on a different branch.

## Quality Checks

```bash
bun fmt        # Format (oxfmt)
bun lint       # Lint (oxlint) - some pre-existing warnings are expected
bun typecheck  # TypeScript check across all 7 packages
bun test       # Run all tests
```

## Repo Structure

- `packages/contracts/` - Shared types, schemas, event/command definitions (Effect Schema)
- `apps/server/` - Backend: orchestration engine, event sourcing, projections, persistence
- `apps/web/` - React frontend (Vite, TanStack Router)
- `apps/desktop/` - Electron shell wrapping the server + web app
- `apps/marketing/` - Astro marketing site

## Event Sourcing Architecture

- Commands are dispatched via WebSocket to the orchestration engine
- The decider (`apps/server/src/orchestration/decider.ts`) validates commands and produces events
- The projector (`apps/server/src/orchestration/projector.ts`) applies events to the in-memory read model
- The ProjectionPipeline materializes events to SQLite for persistence
- Reactors (e.g. `TurnQueueReactor`) automatically trigger follow-up commands based on events
