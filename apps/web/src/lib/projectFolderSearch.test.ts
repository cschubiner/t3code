import type { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { buildProjectFolderSearchResults } from "./projectFolderSearch";

const PROJECTS = [
  {
    id: "project-alpha" as ProjectId,
    name: "Alpha",
    cwd: "/repo/alpha",
    model: "gpt-5",
    expanded: true,
    scripts: [],
  },
  {
    id: "project-beta" as ProjectId,
    name: "Beta",
    cwd: "/repo/team/beta-service",
    model: "gpt-5",
    expanded: true,
    scripts: [],
  },
  {
    id: "project-gamma" as ProjectId,
    name: "Gamma",
    cwd: "/repo/gamma",
    model: "gpt-5",
    expanded: false,
    scripts: [],
  },
] satisfies Project[];

describe("buildProjectFolderSearchResults", () => {
  it("returns sidebar order when the query is empty", () => {
    const results = buildProjectFolderSearchResults({
      projects: PROJECTS,
      query: "",
    });

    expect(results.results.map((result) => result.project.id)).toEqual(
      PROJECTS.map((project) => project.id),
    );
  });

  it("prefers name matches ahead of path-only matches", () => {
    const results = buildProjectFolderSearchResults({
      projects: PROJECTS,
      query: "beta",
    });

    expect(results.results[0]?.project.id).toBe("project-beta");
  });

  it("supports fuzzy subsequence matches", () => {
    const results = buildProjectFolderSearchResults({
      projects: PROJECTS,
      query: "bt",
    });

    expect(results.results.map((result) => result.project.id)).toContain("project-beta");
  });

  it("matches against project folder paths as well as names", () => {
    const results = buildProjectFolderSearchResults({
      projects: PROJECTS,
      query: "team/beta",
    });

    expect(results.results[0]?.project.id).toBe("project-beta");
  });

  it("reports truncation when a limit is applied", () => {
    const results = buildProjectFolderSearchResults({
      projects: PROJECTS,
      query: "",
      limit: 1,
    });

    expect(results.results).toHaveLength(1);
    expect(results.totalResults).toBe(3);
    expect(results.truncated).toBe(true);
  });
});
