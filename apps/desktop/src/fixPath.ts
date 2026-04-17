/**
 * Fix the process PATH for Electron-spawned subshells on macOS.
 *
 * When a user launches ClayCode.app from Finder, Dock, or Spotlight, the
 * app inherits a minimal PATH (usually `/usr/bin:/bin:/usr/sbin:/sbin`).
 * That's fine for the Electron runtime itself, but every shell ClayCode
 * spawns (git, codex, brew-installed CLIs, mise-managed toolchains) then
 * fails to find the binaries users rely on.
 *
 * We call this once at desktop bootstrap, BEFORE any child processes are
 * started, so every downstream `spawn`/`execFile` sees the real shell's
 * PATH. No-op off macOS — Linux and Windows launcher environments
 * already have the right PATH.
 */
import { readPathFromLoginShell } from "@t3tools/shared/shell";

export function fixPath(): void {
  if (process.platform !== "darwin") return;

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const result = readPathFromLoginShell(shell);
    if (result) {
      process.env.PATH = result;
    }
  } catch {
    // Keep inherited PATH if shell lookup fails (sandboxed / signed profile
    // restrictions, missing dotfiles, etc.) — worse than a real PATH but
    // better than crashing the entire app at launch.
  }
}
