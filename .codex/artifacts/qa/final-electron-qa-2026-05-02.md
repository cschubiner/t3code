# Final Electron QA - 2026-05-02

Branch: `codex/rebuild-feature-rollout`

Workspace: `/Users/canal/.codex/worktrees/28c4/t3code`

Electron QA state:

- App launched from branch with `T3CODE_HOME=/tmp/t3code-electron-qa-home-final-2`.
- QA project: `/tmp/qa-project-claycode-replay`.
- App title and sidebar masthead rendered as `ClayCode (Alpha)` / `ClayCode ALPHA`.
- Electron rebuild completed before the final manual pass, so the visible app used current branch assets.

Manual QA performed with Computer Use:

- Added `/tmp/qa-project-claycode-replay` from the desktop Add project flow in a clean profile.
- Sent a live GPT-5.4 thread seed and verified a rendered model response.
- Verified `cmd+k`, `cmd+shift+s`, `cmd+shift+k`, `cmd+shift+f`, `cmd+alt+f`, and `cmd+alt+p` in Electron after the physical-key fallback fix for Option-modified macOS keys.
- Verified sidebar traversal hotkeys in Electron: `cmd+shift+]`, `cmd+shift+[`, `alt+Down`, `alt+Up`, `alt+shift+Down`, and `alt+shift+Up`.
- Verified Settings rebrand text and Tailscale/network-access confirmation copy in Electron.
- Verified Queue + Steer in Electron with a controlled `sleep 60` run:
  - A running turn showed the stop button and active working state.
  - The composer displayed `Steer` and `Queue` actions while the turn was active.
  - Clicking `Queue` created the `1 queued follow-up` panel with `Alt+Up/Down` and `Alt+Shift+Up/Down` row guidance.
  - The queued follow-up auto-dispatched after the running turn settled and rendered `queued follow-up processed`.
  - Clicking `Steer` inserted a live steer message during the active turn; the model acknowledged it before the queued follow-up ran.
- Verified controlled command execution path during Queue + Steer: model ran `sleep 20` and `sleep 60`, then rendered the requested completions.

Issues found and fixed during this QA pass:

- Sidebar masthead still showed legacy `T3 Code`; fixed by rendering `APP_BASE_NAME` in `Sidebar`.
- macOS Option-modified direct hotkeys such as `cmd+alt+f` and `cmd+alt+p` did not resolve reliably; fixed by adding `event.code` letter aliases in keybinding resolution.
- Disconnect/reconnect toast copy still hardcoded `T3 Server`; fixed to use `ClayCode Server` via `APP_BASE_NAME`.
- Electron launcher attempted the renamed launcher path during local start; fixed by only using the renamed launcher when `T3CODE_USE_RENAMED_ELECTRON_LAUNCHER=1`.

Residual risks / not fully re-exercised manually:

- I killed the desktop backend after the toast-copy fix, but the UI did not surface a disconnect toast before shutdown; the copy fix is code-reviewed and included in the rebuilt app, but that specific toast title was not visually observed after the fix.
- GitHub PR pills were not live-verified against a real GitHub PR in this final Electron session; earlier browser/component coverage remains the confidence source for that feature.

Automated gates to run after this artifact:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
- `bun run build`
- `bun run build:desktop`
- `bun run test:desktop-smoke`
