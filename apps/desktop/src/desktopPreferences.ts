import * as Fs from "node:fs";
import * as Path from "node:path";

export interface DesktopPreferences {
  readonly remoteAccess: {
    readonly enabled: boolean;
  };
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  remoteAccess: {
    enabled: false,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeDesktopPreferences(input: unknown): DesktopPreferences {
  if (!isRecord(input)) {
    return DEFAULT_DESKTOP_PREFERENCES;
  }

  const remoteAccess = isRecord(input.remoteAccess) ? input.remoteAccess : null;
  return {
    remoteAccess: {
      enabled: remoteAccess?.enabled === true,
    },
  };
}

export function loadDesktopPreferences(filePath: string): DesktopPreferences {
  try {
    const raw = Fs.readFileSync(filePath, "utf8");
    return normalizeDesktopPreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_DESKTOP_PREFERENCES;
  }
}

export function saveDesktopPreferences(
  filePath: string,
  preferences: DesktopPreferences,
): DesktopPreferences {
  const normalized = normalizeDesktopPreferences(preferences);
  Fs.mkdirSync(Path.dirname(filePath), { recursive: true });
  Fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
