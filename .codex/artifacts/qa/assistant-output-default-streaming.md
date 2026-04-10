# Assistant Output Default Streaming QA

Date: 2026-04-10
Repo: `/Users/canal/.codex/worktrees/84db/t3code`
State dir: `/Users/canal/.t3/userdata`
QA tier: Standard
Backend used: playwright-electron-control

## Claims Under Test

- A persisted profile that omits `enableAssistantStreaming` should stream assistant output by default.
- Settings should make the assistant-output behavior easier to understand.
- Explicit buffered mode should still remain covered by regression tests.

## Reproduction

Confirmed the real persisted profile omitted the setting entirely:

- `/Users/canal/.t3/userdata/settings.json`
  - did not contain `enableAssistantStreaming`

Confirmed the pre-fix desktop UI treated that omission as buffered mode:

- Opened Settings in a Playwright-controlled Electron session against `/Users/canal/.t3/userdata`
- Observed:
  - label: `Assistant output`
  - description: `Show token-by-token output while a response is in progress.`
  - switch state: `aria-checked="false"`

This matched the reported symptom that assistant responses only appeared once a turn finished.

## Fix Verification

### Automated tests

- `cd packages/contracts && bun run test src/settings.test.ts`
  - Passed
- `cd apps/server && bun run test src/serverSettings.test.ts src/orchestration/Layers/ProviderRuntimeIngestion.test.ts src/provider/codexEnv.test.ts src/provider/Layers/ProviderRegistry.test.ts`
  - Passed
- `bun run fmt`
  - Passed
- `bun run lint`
  - Passed
- `bun run typecheck`
  - Passed

### Desktop settings verification

Rebuilt the desktop app, relaunched it against `/Users/canal/.t3/userdata`, and reopened Settings.

Observed after the fix:

- label: `Stream assistant output`
- description: `Show output as it arrives while a response is in progress.`
- switch state: `aria-checked="true"`

## Notes

- The root cause was the server-settings decode default, not a hidden UI-only buffering bug.
- The buffered delivery path is still covered in `ProviderRuntimeIngestion.test.ts`, but it now requires `enableAssistantStreaming: false` explicitly.
- I did not complete a second live provider turn inside the desktop window in this QA pass. The post-fix live verification focused on the real persisted settings state plus the orchestration ingestion regression coverage that exercises buffered vs streaming message delivery semantics.
