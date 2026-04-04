import { describe, expect, it } from "vitest";

import {
  buildGitHubPullRequestUrl,
  normalizeGitHubPullRequestReference,
  normalizeGitHubPullRequestUrl,
  parseGitHubPullRequestUrl,
} from "./githubPullRequest";

describe("parseGitHubPullRequestUrl", () => {
  it("parses canonical GitHub pull request urls", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/pingdotgg/t3code/pull/88")).toEqual({
      owner: "pingdotgg",
      repo: "t3code",
      number: "88",
    });
  });

  it("parses pull request urls with anchors and slack-style labels", () => {
    expect(
      parseGitHubPullRequestUrl(
        "https://github.com/ROKT/canal/pull/15722#pullrequestreview-3992834654",
      ),
    ).toEqual({
      owner: "ROKT",
      repo: "canal",
      number: "15722",
    });

    expect(parseGitHubPullRequestUrl("https://github.com/ROKT/canal/pull/15724|this-PR")).toEqual({
      owner: "ROKT",
      repo: "canal",
      number: "15724",
    });
  });
});

describe("buildGitHubPullRequestUrl", () => {
  it("builds a canonical pull request url", () => {
    expect(
      buildGitHubPullRequestUrl({
        owner: "openai",
        repo: "codex",
        number: "7",
      }),
    ).toBe("https://github.com/openai/codex/pull/7");
  });
});

describe("normalizeGitHubPullRequestUrl", () => {
  it("strips trailing path, fragment, and slack label details", () => {
    expect(normalizeGitHubPullRequestUrl("https://github.com/pingdotgg/t3code/pull/88/files")).toBe(
      "https://github.com/pingdotgg/t3code/pull/88",
    );
    expect(
      normalizeGitHubPullRequestUrl(
        "https://github.com/ROKT/canal/pull/15722#pullrequestreview-3992834654",
      ),
    ).toBe("https://github.com/ROKT/canal/pull/15722");
    expect(normalizeGitHubPullRequestUrl("https://github.com/ROKT/canal/pull/15724|this PR")).toBe(
      "https://github.com/ROKT/canal/pull/15724",
    );
  });
});

describe("normalizeGitHubPullRequestReference", () => {
  it("preserves numeric references for gh pr view", () => {
    expect(normalizeGitHubPullRequestReference("#42")).toBe("42");
  });

  it("canonicalizes github pull request urls", () => {
    expect(
      normalizeGitHubPullRequestReference(
        "https://github.com/ROKT/canal/pull/15722#pullrequestreview-3992834654",
      ),
    ).toBe("https://github.com/ROKT/canal/pull/15722");
  });
});
