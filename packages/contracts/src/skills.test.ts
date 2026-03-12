import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { SkillSearchInput, SkillSearchResult } from "./skills";

const decodeSkillSearchInput = Schema.decodeUnknownEffect(SkillSearchInput);
const decodeSkillSearchResult = Schema.decodeUnknownEffect(SkillSearchResult);

it.effect("accepts skill search inputs with optional roots", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSkillSearchInput({
      cwd: " /tmp/workspace ",
      query: " slack ",
      limit: 20,
      codexHomePath: " ~/.codex ",
      extraRoots: [" /Users/me/.codex/skills ", " /tmp/custom-skills "],
    });

    assert.deepStrictEqual(parsed, {
      cwd: "/tmp/workspace",
      query: "slack",
      limit: 20,
      codexHomePath: "~/.codex",
      extraRoots: ["/Users/me/.codex/skills", "/tmp/custom-skills"],
    });
  }),
);

it.effect("accepts skill search results with optional descriptions", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeSkillSearchResult({
      skills: [
        {
          name: "slackcli",
          description: "Slack CLI workflow",
          skillPath: "/tmp/.codex/skills/slackcli/SKILL.md",
          rootPath: "/tmp/.codex/skills",
          source: "codex-home",
        },
        {
          name: "local-skill",
          skillPath: "/repo/.codex/skills/local-skill/SKILL.md",
          rootPath: "/repo/.codex/skills",
          source: "workspace",
        },
      ],
      truncated: false,
    });

    assert.strictEqual(parsed.skills.length, 2);
    assert.strictEqual(parsed.skills[0]?.name, "slackcli");
    assert.strictEqual(parsed.skills[1]?.description, undefined);
  }),
);
