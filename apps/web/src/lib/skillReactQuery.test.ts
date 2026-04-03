import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../nativeApi", () => ({
  ensureNativeApi: vi.fn(),
}));

import * as nativeApi from "../nativeApi";
import { skillQueryKeys, skillSearchQueryOptions } from "./skillReactQuery";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skillQueryKeys.search", () => {
  it("includes cwd, codex home path, and extra roots in the query key", () => {
    expect(skillQueryKeys.search("/repo", "agent", 40, "", ["/one"])).not.toEqual(
      skillQueryKeys.search("/repo", "agent", 40, "/Users/me/.codex", ["/one"]),
    );
    expect(skillQueryKeys.search("/repo", "agent", 40, "", ["/one"])).not.toEqual(
      skillQueryKeys.search("/repo", "agent", 40, "", ["/two"]),
    );
  });
});

describe("skillSearchQueryOptions", () => {
  it("forwards the skill query to the native API", async () => {
    const search = vi.fn().mockResolvedValue({
      skills: [
        {
          name: "agent-browser",
          description: "Browser automation skill",
          skillPath: "/Users/test/.codex/skills/agent-browser/SKILL.md",
          rootPath: "/Users/test/.codex/skills",
          source: "codex-home",
        },
      ],
      truncated: false,
    });
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      skills: {
        search,
      },
    } as unknown as ReturnType<typeof nativeApi.ensureNativeApi>);

    const queryClient = new QueryClient();
    const result = await queryClient.fetchQuery(
      skillSearchQueryOptions({
        cwd: "/repo",
        query: "agent",
        codexHomePath: "/Users/test/.codex",
        extraRoots: ["/tmp/custom-skills"],
      }),
    );

    expect(search).toHaveBeenCalledWith({
      cwd: "/repo",
      query: "agent",
      limit: 40,
      codexHomePath: "/Users/test/.codex",
      extraRoots: ["/tmp/custom-skills"],
    });
    expect(result).toEqual({
      skills: [
        {
          name: "agent-browser",
          description: "Browser automation skill",
          skillPath: "/Users/test/.codex/skills/agent-browser/SKILL.md",
          rootPath: "/Users/test/.codex/skills",
          source: "codex-home",
        },
      ],
      truncated: false,
    });
  });

  it("disables the query when cwd is unavailable", () => {
    const options = skillSearchQueryOptions({
      cwd: null,
      query: "agent",
      codexHomePath: "",
      extraRoots: [],
    });

    expect(options.enabled).toBe(false);
  });
});
