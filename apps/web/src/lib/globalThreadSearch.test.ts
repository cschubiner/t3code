import { MessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Project, Thread } from "../types";
import {
  buildGlobalThreadSearchResults,
  GLOBAL_THREAD_SEARCH_RESULT_LIMIT,
} from "./globalThreadSearch";

const projectA: Project = {
  id: ProjectId.makeUnsafe("project-a"),
  name: "Alpha",
  cwd: "/repo/a",
  defaultModelSelection: null,
  scripts: [],
};

const projectB: Project = {
  id: ProjectId.makeUnsafe("project-b"),
  name: "Beta",
  cwd: "/repo/b",
  defaultModelSelection: null,
  scripts: [],
};

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Thread["latestTurn"] {
  return {
    turnId: TurnId.makeUnsafe("turn-1"),
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-01T00:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-01T00:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-01T00:00:01.000Z",
  };
}

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
    latestTurn: overrides.latestTurn ?? null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("buildGlobalThreadSearchResults", () => {
  it("finds content and title matches across threads", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: projectA.id,
        title: "Alpha roadmap",
        latestTurn: makeLatestTurn({
          startedAt: "2026-03-02T00:00:00.000Z",
          completedAt: "2026-03-02T00:00:01.000Z",
        }),
        messages: [
          {
            id: MessageId.makeUnsafe("message-1"),
            role: "assistant",
            text: "[Needle](https://hidden.example.com)",
            createdAt: "2026-03-02T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        projectId: projectB.id,
        title: "Shipping",
        messages: [
          {
            id: MessageId.makeUnsafe("message-2"),
            role: "user",
            text: "Needle in a user message",
            createdAt: "2026-03-01T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const results = buildGlobalThreadSearchResults({
      threads,
      projects: [projectA, projectB],
      query: "needle",
    });

    expect(results.totalResults).toBe(2);
    expect(results.results.map((result) => result.kind)).toEqual([
      "message-assistant",
      "message-user",
    ]);
    expect(results.results[0]?.projectName).toBe("Alpha");
    expect(results.results[1]?.projectName).toBe("Beta");
  });

  it("includes title matches but not project-name-only matches", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: projectA.id,
        title: "Alpha roadmap",
      }),
    ];

    const titleResults = buildGlobalThreadSearchResults({
      threads,
      projects: [projectA],
      query: "roadmap",
    });
    expect(titleResults.totalResults).toBe(1);
    expect(titleResults.results[0]?.kind).toBe("title");

    const projectResults = buildGlobalThreadSearchResults({
      threads,
      projects: [projectA],
      query: "alpha",
    });
    expect(projectResults.totalResults).toBe(1);
    expect(projectResults.results[0]?.kind).toBe("title");

    const metadataOnlyResults = buildGlobalThreadSearchResults({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-2"),
          projectId: projectA.id,
          title: "Shipping",
        }),
      ],
      projects: [projectA],
      query: "alpha",
    });
    expect(metadataOnlyResults.totalResults).toBe(0);
  });

  it("sorts most recent first", () => {
    const threads: Thread[] = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: projectA.id,
        title: "One",
        messages: [
          {
            id: MessageId.makeUnsafe("message-1"),
            role: "user",
            text: "needle old",
            createdAt: "2026-03-01T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        projectId: projectA.id,
        title: "Two",
        messages: [
          {
            id: MessageId.makeUnsafe("message-2"),
            role: "user",
            text: "needle new",
            createdAt: "2026-03-02T00:00:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const results = buildGlobalThreadSearchResults({
      threads,
      projects: [projectA],
      query: "needle",
    });

    expect(results.results.map((result) => result.threadId)).toEqual(["thread-2", "thread-1"]);
  });

  it("caps the rendered result list", () => {
    const thread = makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      projectId: projectA.id,
      title: "Needle",
      messages: Array.from({ length: GLOBAL_THREAD_SEARCH_RESULT_LIMIT + 20 }, (_, index) => ({
        id: MessageId.makeUnsafe(`message-${index}`),
        role: "user" as const,
        text: `needle ${index}`,
        createdAt: `2026-03-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`,
        streaming: false,
      })),
    });

    const results = buildGlobalThreadSearchResults({
      threads: [thread],
      projects: [projectA],
      query: "needle",
    });

    expect(results.results).toHaveLength(GLOBAL_THREAD_SEARCH_RESULT_LIMIT);
    expect(results.totalResults).toBeGreaterThan(GLOBAL_THREAD_SEARCH_RESULT_LIMIT);
    expect(results.truncated).toBe(true);
  });
});
