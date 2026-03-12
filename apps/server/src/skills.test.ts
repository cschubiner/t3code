import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, assert, describe, it, vi } from "vitest";

import { searchSkills } from "./skills";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(rootPath: string, segments: string[], contents: string): string {
  const skillDir = path.join(rootPath, ...segments);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(skillPath, contents, "utf8");
  return skillPath;
}

describe("searchSkills", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers workspace, extra-root, and codex-home skills with workspace precedence", async () => {
    const workspace = makeTempDir("t3code-skills-workspace-");
    const extraRoot = makeTempDir("t3code-skills-extra-");
    const codexHome = makeTempDir("t3code-skills-home-");

    writeSkill(
      path.join(workspace, ".codex", "skills"),
      ["slackcli"],
      "---\nname: slackcli\ndescription: Workspace version\n---\n# Workspace\n",
    );
    writeSkill(
      extraRoot,
      ["slackcli"],
      "---\nname: slackcli\ndescription: Extra root version\n---\n# Extra\n",
    );
    writeSkill(
      extraRoot,
      ["extra-helper"],
      "---\nname: extra-helper\ndescription: Extra only skill\n---\n# Extra helper\n",
    );
    writeSkill(
      path.join(codexHome, "skills"),
      ["nested", "slackcli"],
      "---\nname: slackcli\ndescription: Codex home version\n---\n# Home\n",
    );
    writeSkill(
      path.join(codexHome, "skills"),
      ["project-search"],
      "---\nname: project-search\ndescription: Search projects\n---\n# Search\n",
    );

    const result = await searchSkills({
      cwd: workspace,
      query: "slack",
      limit: 10,
      codexHomePath: codexHome,
      extraRoots: [extraRoot],
    });

    assert.deepStrictEqual(result, {
      skills: [
        {
          name: "slackcli",
          description: "Workspace version",
          skillPath: path.join(workspace, ".codex", "skills", "slackcli", "SKILL.md"),
          rootPath: path.join(workspace, ".codex", "skills"),
          source: "workspace",
        },
      ],
      truncated: false,
    });

    const extraAndHomeResult = await searchSkills({
      cwd: workspace,
      query: "helper",
      limit: 10,
      codexHomePath: codexHome,
      extraRoots: [extraRoot],
    });

    assert.deepStrictEqual(extraAndHomeResult, {
      skills: [
        {
          name: "extra-helper",
          description: "Extra only skill",
          skillPath: path.join(extraRoot, "extra-helper", "SKILL.md"),
          rootPath: extraRoot,
          source: "extra-root",
        },
      ],
      truncated: false,
    });

    const codexHomeResult = await searchSkills({
      cwd: workspace,
      query: "project",
      limit: 10,
      codexHomePath: codexHome,
      extraRoots: [extraRoot],
    });

    assert.deepStrictEqual(codexHomeResult, {
      skills: [
        {
          name: "project-search",
          description: "Search projects",
          skillPath: path.join(codexHome, "skills", "project-search", "SKILL.md"),
          rootPath: path.join(codexHome, "skills"),
          source: "codex-home",
        },
      ],
      truncated: false,
    });
  });

  it("falls back to directory names when frontmatter is missing or malformed", async () => {
    const workspace = makeTempDir("t3code-skills-frontmatter-");
    const codexHome = makeTempDir("t3code-skills-frontmatter-home-");
    const skillRoot = path.join(workspace, ".codex", "skills");

    writeSkill(skillRoot, ["plain-skill"], "# Plain\n");
    writeSkill(skillRoot, ["broken-skill"], "---\nname: [oops\n---\n# Broken\n");

    const result = await searchSkills({
      cwd: workspace,
      query: "skill",
      limit: 10,
      codexHomePath: codexHome,
    });

    assert.deepStrictEqual(
      result.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
      })),
      [
        { name: "broken-skill", description: undefined, source: "workspace" },
        { name: "plain-skill", description: undefined, source: "workspace" },
      ],
    );
  });

  it("ignores unreadable skill files without failing the whole search", async () => {
    const workspace = makeTempDir("t3code-skills-unreadable-");
    const codexHome = makeTempDir("t3code-skills-unreadable-home-");
    const skillRoot = path.join(workspace, ".codex", "skills");
    const unreadableSkillPath = writeSkill(
      skillRoot,
      ["broken"],
      "---\nname: broken\ndescription: Should not load\n---\n# Broken\n",
    );
    writeSkill(
      skillRoot,
      ["healthy"],
      "---\nname: healthy\ndescription: Healthy skill\n---\n# Healthy\n",
    );

    const originalReadFile = fsPromises.readFile.bind(fsPromises);
    vi.spyOn(fsPromises, "readFile").mockImplementation((async (...args) => {
      if (args[0] === unreadableSkillPath) {
        throw new Error("permission denied");
      }
      return originalReadFile(...args);
    }) as typeof fsPromises.readFile);

    const result = await searchSkills({
      cwd: workspace,
      query: "h",
      limit: 10,
      codexHomePath: codexHome,
    });

    assert.deepStrictEqual(result, {
      skills: [
        {
          name: "healthy",
          description: "Healthy skill",
          skillPath: path.join(skillRoot, "healthy", "SKILL.md"),
          rootPath: skillRoot,
          source: "workspace",
        },
      ],
      truncated: false,
    });
  });

  it("respects the result limit and reports truncation", async () => {
    const workspace = makeTempDir("t3code-skills-limit-");
    const codexHome = makeTempDir("t3code-skills-limit-home-");
    const skillRoot = path.join(workspace, ".codex", "skills");

    writeSkill(skillRoot, ["slackcli"], "---\nname: slackcli\n---\n# Slack\n");
    writeSkill(skillRoot, ["slack-bug-investigation"], "---\nname: slack-bug-investigation\n---\n");
    writeSkill(skillRoot, ["slack-audit"], "---\nname: slack-audit\n---\n");

    const result = await searchSkills({
      cwd: workspace,
      query: "slack",
      limit: 2,
      codexHomePath: codexHome,
    });

    assert.lengthOf(result.skills, 2);
    assert.isTrue(result.truncated);
  });
});
