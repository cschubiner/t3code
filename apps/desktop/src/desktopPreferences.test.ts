import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_PREFERENCES,
  loadDesktopPreferences,
  normalizeDesktopPreferences,
  saveDesktopPreferences,
} from "./desktopPreferences";

const createdDirectories = new Set<string>();

afterEach(() => {
  for (const directory of createdDirectories) {
    Fs.rmSync(directory, { recursive: true, force: true });
  }
  createdDirectories.clear();
});

function makeTempPath(): string {
  const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), "t3code-desktop-preferences-"));
  createdDirectories.add(directory);
  return Path.join(directory, "desktop-preferences.json");
}

describe("desktopPreferences", () => {
  it("falls back to defaults when the file is missing or invalid", () => {
    const missingPath = makeTempPath();
    expect(loadDesktopPreferences(missingPath)).toEqual(DEFAULT_DESKTOP_PREFERENCES);

    Fs.writeFileSync(missingPath, "{ not-json", "utf8");
    expect(loadDesktopPreferences(missingPath)).toEqual(DEFAULT_DESKTOP_PREFERENCES);
  });

  it("normalizes unknown shapes to a safe default", () => {
    expect(normalizeDesktopPreferences(null)).toEqual(DEFAULT_DESKTOP_PREFERENCES);
    expect(normalizeDesktopPreferences({ remoteAccess: { enabled: "yes" } })).toEqual(
      DEFAULT_DESKTOP_PREFERENCES,
    );
  });

  it("persists and reloads the remote access preference", () => {
    const filePath = makeTempPath();
    saveDesktopPreferences(filePath, {
      remoteAccess: {
        enabled: true,
      },
    });

    expect(loadDesktopPreferences(filePath)).toEqual({
      remoteAccess: {
        enabled: true,
      },
    });
  });
});
