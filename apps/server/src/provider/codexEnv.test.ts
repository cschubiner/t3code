import { describe, expect, it } from "vitest";

import { buildCodexProcessEnv, getCodexApiKeyEnvironmentNotice } from "./codexEnv";

describe("buildCodexProcessEnv", () => {
  it("removes inherited OPENAI_ORGANIZATION while preserving other values", () => {
    const baseEnv = {
      OPENAI_API_KEY: "sk-test",
      OPENAI_ORGANIZATION: "org-mismatch",
      PATH: "/usr/bin",
      CODEX_HOME: "/tmp/original-codex-home",
    } satisfies NodeJS.ProcessEnv;

    const env = buildCodexProcessEnv({
      baseEnv,
      homePath: "/tmp/override-codex-home",
    });

    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.OPENAI_ORGANIZATION).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.CODEX_HOME).toBe("/tmp/override-codex-home");
  });

  it("does not mutate the provided base environment", () => {
    const baseEnv = {
      OPENAI_ORGANIZATION: "org-mismatch",
    } satisfies NodeJS.ProcessEnv;

    const env = buildCodexProcessEnv({ baseEnv });

    expect(baseEnv.OPENAI_ORGANIZATION).toBe("org-mismatch");
    expect(env.OPENAI_ORGANIZATION).toBeUndefined();
  });

  it("returns a notice when api key auth is paired with OPENAI_ORGANIZATION", () => {
    const notice = getCodexApiKeyEnvironmentNotice({
      authType: "apiKey",
      baseEnv: {
        OPENAI_ORGANIZATION: "org-mismatch",
      },
    });

    expect(notice).toContain("OPENAI_ORGANIZATION");
    expect(notice).toContain("ignores it");
  });

  it("does not return a notice when OPENAI_ORGANIZATION is absent", () => {
    const notice = getCodexApiKeyEnvironmentNotice({
      authType: "apiKey",
      baseEnv: {},
    });

    expect(notice).toBeUndefined();
  });
});
