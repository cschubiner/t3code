# Codex Auth Refresh And Send QA

Date: 2026-04-09
Repo: `/Users/canal/.codex/worktrees/84db/t3code`
State dir: `/Users/canal/.t3/userdata`
QA tier: Standard

## Inventory

- Settings should still show Codex authenticated after startup.
- A real Codex runtime turn should succeed even when the parent shell still exports a mismatched `OPENAI_ORGANIZATION`.
- The desktop app should be rebuilt from this worktree and relaunched against the main local persisted state.

## Reproduction

Confirmed the failure outside T3 first:

- `OPENAI_ORGANIZATION="$OPENAI_ORGANIZATION" codex exec --skip-git-repo-check --model gpt-5.4-mini 'Reply with OK and nothing else.'`
  - Failed with `401 Unauthorized` and `mismatched_organization`
- `env -u OPENAI_ORGANIZATION codex exec --skip-git-repo-check --model gpt-5.4-mini 'Reply with OK and nothing else.'`
  - Succeeded

That isolated the bug to inherited environment passed into Codex subprocesses.

## Fix Verification

### Automated tests

- `cd apps/server && bun run test src/provider/codexEnv.test.ts src/provider/Layers/ProviderRegistry.test.ts src/codexAppServerManager.test.ts`
  - Passed
- `bun run fmt`
  - Passed
- `bun run lint`
  - Passed
- `bun run typecheck`
  - Passed

### Electron settings verification

Launched the rebuilt Electron app from this worktree under Playwright control against `/Users/canal/.t3/userdata`.

Observed on Settings:

- `Codex v0.118.0`
- `Authenticated · OpenAI API Key`
- `Claude v2.1.97`
- `Authenticated`

### Live Codex runtime verification

Ran a real `CodexAppServerManager` session in the same shell where `OPENAI_ORGANIZATION` is still set to the mismatched value.

Result:

- `startSession()` succeeded
- `sendTurn()` succeeded
- Turn completed successfully
- No `mismatched_organization`
- No `401 Unauthorized`

Observed completion marker:

- `TURN_COMPLETED 1`

## Notes

- The empty-state UI in this persisted state currently opens project creation through the native folder picker on macOS, which is awkward to script cleanly in Playwright. I verified the user-visible provider state in Settings and verified the exact backend send path directly through `CodexAppServerManager`, which is the runtime path the UI ultimately uses.

## Follow-up Debug Findings

The apparently contradictory "CLI works" evidence came from different Codex processes inheriting different OpenAI environments.

### Proven states

1. Current shell used by this Codex session:
   - `OPENAI_API_KEY=sk-svcacct-68ap...`
   - `OPENAI_ORGANIZATION=org-aAqY...`
   - `codex login status` reports `Logged in using an API key`
   - `codex exec ...` fails with `mismatched_organization`
   - `env -u OPENAI_ORGANIZATION codex exec ...` succeeds

2. Successful interactive TUI session from `2026-04-09 17:14`:
   - Shell snapshot: `/Users/canal/.codex/shell_snapshots/019d733d-3688-7b82-9d7b-5ac4cc9498a9.1775754884820642000.sh`
   - Contains `OPENAI_API_KEY`
   - Does **not** contain `OPENAI_ORGANIZATION`
   - `codex-tui.log` shows a successful websocket-backed turn with no `mismatched_organization`

3. Current parent Codex desktop app-server process:
   - `ps eww -p <codex-app-server-pid>` shows:
     - stale broken `OPENAI_API_KEY=sk-svcacct-J6U6...`
     - `OPENAI_ORGANIZATION=org-aAqY...`
   - This environment does not match current dotfiles and indicates the app process was started from an older shell state

### Conclusion

There is no single "the CLI environment". Different Codex invocations on this machine are inheriting different OpenAI env combinations:

- `API key only` works
- `API key + mismatched organization` breaks websocket/runtime flows
- long-running GUI/app processes may still be carrying stale env from earlier shell launches

This explains why one visible interactive Codex session could work while `codex exec` and T3 runtime paths failed.
