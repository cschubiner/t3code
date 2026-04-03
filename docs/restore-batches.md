# Restore Batches

This file turns the missing-commit ledger into execution order. The rule is:
every commit in `docs/missing-commit-ledger.md` must end up either replayed,
adapted, or intentionally superseded with a concrete replacement.

## Batch 0: Safety and Sync Repairs

Start here so later restores land on a stable base.

- `4b33147d` Restore MessagesTimeline virtualization row markers
- `8b9ce137` Fix sync migration registry and snapshot expectations
- `fb7547fd` fix browser rpc harness bootstrapping
- `552405b4` fix browser rpc harness bootstrapping
- `8eb3c648` stabilize keybindings toast replay test
- `4956345b` stabilize keybindings toast browser test
- `c4bed798` stabilize chatview browser checks
- `edcf6a1e` Fix git test timeouts and process cleanup
- `9ac3a320` run CI quality job on ubuntu runner
- `3e8e0a5b` fix web auto-animate typings

## Batch 1: Composer, Search, and Shortcuts

Restore the broad keyboard/composer surface before layering on skill/snippet
data sources.

- `6f3f6a98` add branch selector shortcut
- `c51d424a` scope branch selector focus to active thread
- `a548d570` fix disabled branch selector on new threads
- `76f615e3` add terminal focus coverage for branch selector shortcut
- `eb736396` fix browser test setup for branch selector shortcut
- `a89a9820` add thread search shortcuts -> restored in `27e804de`
- `936b5e03` add project folder fuzzy search shortcut -> restored in `17e6583d`
- `db6fb355` dedupe global thread search results -> restored in `f45f31aa`
- `fd55d0bb` show relative time in thread search -> restored in `82d83ad4`
- `58e9fac3` add browser coverage for thread search timestamps
- `9b55f906` fix merged thread search validation
- `6d6b35b0` fix slash command ranking -> restored in `9bbf39f2`
- `e56d17af` add delete slash command -> folded into `9bbf39f2`
- `5db9583a` add delete slash command -> restored in `9bbf39f2`
- `dbf3b0a9` add composer env toggle hotkey -> restored in `4feef38f`
- `8bbf907b` Fix composer-focused sidebar hotkeys -> restored in `4feef38f`
- `8cfc8879` docs: add main-state desktop boot shortcut -> restored in `06cae40e`

## Batch 2: Skills and Snippets

Restore contracts and RPC first, then composer integration and tests.

- `71aa0098` add skill autocomplete -> core restore in `beb70920`; extra skill roots settings surface still pending
- `e2d093b8` fix skill autocomplete title layout -> restored in `beb70920`
- `5315ae87` prioritize full skill autocomplete titles -> restored in `beb70920`
- `3c76d535` stabilize skills search websocket test -> restored in `beb70920`
- `6624de80` add global snippets library

## Batch 3: Sidebar and Thread UX

Restore non-queue sidebar UX after the shortcut substrate is back.

- `5a0f3ee4` add sidebar thread navigation keybindings
- `97d8ac89` update sidebar navigation hotkeys
- `8bcfffb5` update sidebar navigation hotkeys
- `ed8555f6` add sidebar rename hotkey
- `c93359cd` add sidebar referenced PR pills
- `3c7a97a1` fix sidebar PR pill formatting
- `8c7af835` dedupe sidebar pr mentions
- `23529a62` fix pr pill merge status lookup
- `f1e49e60` polish sidebar thread rows
- `ff24a79e` match delete navigation to sidebar next thread
- `d54ecdad` shrink sidebar project toggle further
- `246a9aa3` shrink sidebar project toggle
- `c590e6c0` test sidebar navigation with manual project sort
- `0c4160ef` fix sidebar browser test settings seeding
- `a3ba826e` fix sidebar browser settings fixture
- `c9624009` add browser regression test for mobile thread drawer
- `d3c38b69` hide mobile thread drawer after selection

## Batch 4: Auth, Runtime, and Worktree Robustness

These commits likely need adaptation rather than blind cherry-picks.

- `cbef4b51` fix codex auth state recovery
- `dce81e88` downgrade codex provider noise
- `9b56879f` fix stale runtime working state (#82)
- `0e5c9f02` fix stuck working state (#80)
- `1e5ee7f4` fix stale working session state
- `58c7fbef` fix missing sidebar working status
- `7d6f03a6` integrate sidebar working fix with main
- `fd574794` reconcile imported worktree projects
- `c60b7667` fix CI typing for imported worktree reconciliation
- `31d78042` fix desktop rename shortcut

## Batch 5: Codex Import

Restore only after the RPC/runtime layers above are in place.

- `5d6bd166` import from codex
- `fe45f62a` fix codex import timestamp normalization
- `c7e554ff` fix codex import dialog scrolling
- `94e7fcb9` fix: repair legacy projection schema for codex import

## Batch Q: Queue History

These old commits are intentionally not replayed verbatim.

- They are tracked in the ledger as `superseded`.
- Their behavior should be covered by the rebuilt queue architecture on
  current `main`, not by reviving the server-owned queue reactor.
