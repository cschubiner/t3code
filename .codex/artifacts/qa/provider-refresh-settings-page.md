# Provider Refresh QA

Date: 2026-04-08
Repo: `/Users/canal/.codex/worktrees/84db/t3code`
Tier: Standard

## Inventory

- Claim: Clicking the provider refresh control should update the visible provider status and "Checked ..." timestamp.
- Control: Settings page provider refresh button.
- Expected state change: Cached provider data updates immediately after a successful refresh RPC, even before any later config-stream event arrives.
- Evidence target: direct CLI status, targeted regression tests, repo-wide verification.

## Reproduction Notes

- Direct CLI probes in this environment succeeded immediately:
  - `codex --version` -> `codex-cli 0.118.0-alpha.2`
  - `codex login status` -> `Logged in using ChatGPT`
  - `claude --version` -> `2.1.96 (Claude Code)`
  - `claude auth status` -> logged in JSON payload
- That means the screenshot's stale "Unavailable" state can plausibly be old cached data rather than the current truth.
- I attempted a live local app run with `bun run dev`, but the server package is currently blocked in this worktree by local Bun drift:
  - installed Bun: `1.3.10`
  - repo expects: `1.3.9`
  - observed failure: `No such built-in module: node:sqlite`
- I then repaired the QA environment transiently by:
  - using Node `24.13.1` from `~/.nvm/versions/node/v24.13.1/bin`
  - downloading Bun `1.3.9` into a temporary repo-local tool dir for the run
  - building the app with `bun run build`
  - repairing the local Electron install by running `node node_modules/.bun/electron@40.6.0/node_modules/electron/install.js`
  - launching the real desktop app with `bun run start:desktop:main-state`

## Bug Found

- `apps/web/src/wsNativeApi.ts` forwarded `server.refreshProviders()` to the RPC client and returned the payload, but it did not merge the refreshed providers into the shared `serverState` cache.
- The settings page therefore depended on a separate background `providerStatuses` stream event to eventually arrive.
- If that stream event was delayed, dropped, or not yet subscribed, the UI could keep showing stale provider statuses and an old "Checked ..." timestamp after the user clicked refresh.

## Fix

- On successful `server.refreshProviders()` resolution, immediately call `applyProvidersUpdated(payload)` before returning the payload.
- Added a regression test that seeds cached server config, resolves a refresh with newer provider data, and asserts that the cached config now reflects the refreshed providers.

## Verification

- Targeted tests:
  - `cd apps/web && bun run test src/wsNativeApi.test.ts`
  - `cd apps/web && bun run test src/wsNativeApi.test.ts src/rpc/serverState.test.ts`
- Repo checks:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
- Live desktop QA against `~/.t3/userdata`:
  - navigated to `#/settings/general` in a Playwright-controlled Electron session
  - confirmed provider state renders as authenticated for both providers
  - waited until the label aged, then clicked the refresh control and allowed the full probe window to finish
  - observed:
    - before refresh: `Checked 7s ago`
    - after refresh: `Checked just now`
  - observed final provider state:
    - Codex: `Authenticated · ChatGPT Business Subscription`
    - Claude: `Authenticated`

## Residual Risk

- The root `bun run dev` path is still broken in this repo because `apps/server/package.json` runs the Node-based server entrypoint through Bun, which cannot load `node:sqlite`.
- The shipped/built desktop path works, and the settings-page refresh behavior was verified there end to end.
