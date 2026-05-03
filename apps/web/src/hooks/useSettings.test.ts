import { describe, expect, it } from "vitest";
import { buildLegacyClientSettingsMigrationPatch, normalizeExtraSkillRoots } from "./useSettings";

describe("normalizeExtraSkillRoots", () => {
  it("trims, deduplicates, and drops blank roots", () => {
    expect(
      normalizeExtraSkillRoots([
        " /Users/me/.codex/skills ",
        "",
        " /Users/me/.codex/skills ",
        null,
        "/tmp/custom-skills",
      ]),
    ).toEqual(["/Users/me/.codex/skills", "/tmp/custom-skills"]);
  });
});

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });

  it("migrates legacy extra skill roots", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        extraSkillRoots: [" /Users/me/.codex/skills ", "", "/tmp/custom-skills"],
      }),
    ).toEqual({
      extraSkillRoots: ["/Users/me/.codex/skills", "/tmp/custom-skills"],
    });
  });
});
