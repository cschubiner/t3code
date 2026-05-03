import { MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Project, Thread } from "../types";
import {
  buildQuickThreadSearchIndex,
  buildQuickThreadSearchResults,
  QUICK_THREAD_SEARCH_RESULT_LIMIT,
} from "./quickThreadSearch";

const projectA: Project = {
  id: ProjectId.makeUnsafe("project-a"),
  name: "Alpha",
  cwd: "/repo/a",
  defaultModelSelection: null,
  scripts: [],
};

function makeThread(
  overrides: Partial<Thread> & Pick<Thread, "id" | "projectId" | "title">,
): Thread {
  return {
    id: overrides.id,
    codexThreadId: null,
    projectId: overrides.projectId,
    title: overrides.title,
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: overrides.session ?? null,
    messages: overrides.messages ?? [],
    proposedPlans: overrides.proposedPlans ?? [],
    error: null,
    createdAt: overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? "2026-03-01T00:00:00.000Z",
    latestTurn: overrides.latestTurn ?? null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("buildQuickThreadSearchResults", () => {
  it("returns no results for a blank query", () => {
    const index = buildQuickThreadSearchIndex({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-blank"),
          projectId: projectA.id,
          title: "Needle thread",
        }),
      ],
      projects: [projectA],
      recentLimit: 10,
    });

    const results = buildQuickThreadSearchResults({
      index,
      query: "   ",
    });

    expect(results).toEqual({
      results: [],
      totalResults: 0,
      truncated: false,
    });
  });

  it("prefers title matches over equally strong first-message matches", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-title"),
        projectId: projectA.id,
        title: "Needle plan",
        updatedAt: "2026-03-01T00:00:00.000Z",
        messages: [
          {
            id: MessageId.makeUnsafe("message-1"),
            role: "user",
            text: "kickoff text",
            createdAt: "2026-03-01T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-message"),
        projectId: projectA.id,
        title: "Shipping thread",
        updatedAt: "2026-03-02T00:00:00.000Z",
        messages: [
          {
            id: MessageId.makeUnsafe("message-2"),
            role: "user",
            text: "needle needle kickoff",
            createdAt: "2026-03-02T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const index = buildQuickThreadSearchIndex({
      threads,
      projects: [projectA],
      recentLimit: 10,
    });
    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.results.map((result) => result.threadId)).toEqual([
      "thread-title",
      "thread-message",
    ]);
    expect(results.results[0]?.kind).toBe("title");
  });

  it("uses recency when weighted match scores tie", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-old"),
        projectId: projectA.id,
        title: "Needle old",
        updatedAt: "2026-03-01T00:00:00.000Z",
        messages: [
          {
            id: MessageId.makeUnsafe("message-old"),
            role: "user",
            text: "kickoff",
            createdAt: "2026-03-01T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-new"),
        projectId: projectA.id,
        title: "Needle new",
        updatedAt: "2026-03-03T00:00:00.000Z",
        messages: [
          {
            id: MessageId.makeUnsafe("message-new"),
            role: "user",
            text: "kickoff",
            createdAt: "2026-03-03T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const index = buildQuickThreadSearchIndex({
      threads,
      projects: [projectA],
      recentLimit: 10,
    });
    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.results.map((result) => result.threadId)).toEqual(["thread-new", "thread-old"]);
  });

  it("counts matches across the title and first user message", () => {
    const index = buildQuickThreadSearchIndex({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-count"),
          projectId: projectA.id,
          title: "Needle thread",
          messages: [
            {
              id: MessageId.makeUnsafe("message-count"),
              role: "user",
              text: "needle kickoff needle",
              createdAt: "2026-03-02T00:00:00.000Z",
              streaming: false,
            },
          ],
        }),
      ],
      projects: [projectA],
      recentLimit: 10,
    });

    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.results[0]?.kind).toBe("title");
    expect(results.results[0]?.matchCount).toBe(3);
  });

  it("indexes only the first non-empty user message for speed", () => {
    const index = buildQuickThreadSearchIndex({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-first-user"),
          projectId: projectA.id,
          title: "Shipping thread",
          messages: [
            {
              id: MessageId.makeUnsafe("message-empty"),
              role: "user",
              text: "   ",
              createdAt: "2026-03-01T00:00:00.000Z",
              streaming: false,
            },
            {
              id: MessageId.makeUnsafe("message-first"),
              role: "user",
              text: "kickoff prompt",
              createdAt: "2026-03-02T00:00:00.000Z",
              streaming: false,
            },
            {
              id: MessageId.makeUnsafe("message-later"),
              role: "user",
              text: "needle later detail",
              createdAt: "2026-03-03T00:00:00.000Z",
              streaming: false,
            },
          ],
        }),
      ],
      projects: [projectA],
      recentLimit: 10,
    });

    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.totalResults).toBe(0);
  });

  it("falls back to an unknown project label when the project is missing", () => {
    const index = buildQuickThreadSearchIndex({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-unknown-project"),
          projectId: ProjectId.makeUnsafe("missing-project"),
          title: "Needle thread",
        }),
      ],
      projects: [],
      recentLimit: 10,
    });

    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.results[0]?.projectName).toBe("Unknown project");
  });

  it("searches only the indexed recent subset", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-recent"),
        projectId: projectA.id,
        title: "Recent thread",
        updatedAt: "2026-03-03T00:00:00.000Z",
        messages: [
          {
            id: MessageId.makeUnsafe("message-recent"),
            role: "user",
            text: "kickoff",
            createdAt: "2026-03-03T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-older"),
        projectId: projectA.id,
        title: "Older thread",
        updatedAt: "2026-03-02T00:00:00.000Z",
        messages: [
          {
            id: MessageId.makeUnsafe("message-older"),
            role: "user",
            text: "needle older kickoff",
            createdAt: "2026-03-02T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const index = buildQuickThreadSearchIndex({
      threads,
      projects: [projectA],
      recentLimit: 1,
    });
    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.totalResults).toBe(0);
  });

  it("caps rendered results", () => {
    const threads = Array.from({ length: QUICK_THREAD_SEARCH_RESULT_LIMIT + 20 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-${index}`),
        projectId: projectA.id,
        title: `Needle ${index}`,
        updatedAt: `2026-03-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
        messages: [
          {
            id: MessageId.makeUnsafe(`message-${index}`),
            role: "user",
            text: `kickoff ${index}`,
            createdAt: `2026-03-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
            streaming: false,
          },
        ],
      }),
    );

    const index = buildQuickThreadSearchIndex({
      threads,
      projects: [projectA],
      recentLimit: QUICK_THREAD_SEARCH_RESULT_LIMIT + 20,
    });
    const results = buildQuickThreadSearchResults({
      index,
      query: "needle",
    });

    expect(results.results).toHaveLength(QUICK_THREAD_SEARCH_RESULT_LIMIT);
    expect(results.totalResults).toBeGreaterThan(QUICK_THREAD_SEARCH_RESULT_LIMIT);
    expect(results.truncated).toBe(true);
  });
});
