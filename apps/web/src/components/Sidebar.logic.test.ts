import { describe, expect, it } from "vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  isTypingInSidebarTextEntry,
  resolveThreadRowClassName,
  projectNavigationTargetsForSidebar,
  resolveSidebarProjectNavigationTarget,
  resolveSidebarThreadNavigationTarget,
  resolveThreadStatusPill,
  sortThreadsForSidebar,
  shouldClearThreadSelectionOnMouseDown,
  visibleThreadIdsForSidebar,
  visibleThreadsForSidebar,
} from "./Sidebar.logic";
import type { Project, Thread } from "../types";

const PROJECT_A = ProjectId.makeUnsafe("project-a");
const PROJECT_B = ProjectId.makeUnsafe("project-b");
const THREAD_A1 = ThreadId.makeUnsafe("thread-a1");
const THREAD_A2 = ThreadId.makeUnsafe("thread-a2");
const THREAD_A3 = ThreadId.makeUnsafe("thread-a3");
const THREAD_A4 = ThreadId.makeUnsafe("thread-a4");
const THREAD_A5 = ThreadId.makeUnsafe("thread-a5");
const THREAD_A6 = ThreadId.makeUnsafe("thread-a6");
const THREAD_A7 = ThreadId.makeUnsafe("thread-a7");
const THREAD_B1 = ThreadId.makeUnsafe("thread-b1");
const THREAD_B2 = ThreadId.makeUnsafe("thread-b2");

function makeProject(id: Project["id"], name: string, expanded = true): Project {
  return {
    id,
    name,
    cwd: `/repo/${name}`,
    model: "gpt-5",
    expanded,
    scripts: [],
  };
}

function makeThread(id: Thread["id"], projectId: Thread["projectId"], createdAt: string): Thread {
  return {
    id,
    codexThreadId: null,
    projectId,
    title: String(id),
    model: "gpt-5",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    queuedTurns: [],
    proposedPlans: [],
    error: null,
    createdAt,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveSidebarNewThreadEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("isTypingInSidebarTextEntry", () => {
  class FakeHTMLElement {
    parent: FakeHTMLElement | null = null;
    isContentEditable = false;

    constructor(
      readonly tagName: string,
      readonly attributes: Record<string, string> = {},
    ) {}

    closest(selector: string): FakeHTMLElement | null {
      return this.findAncestor((node) => {
        switch (selector) {
          case "[data-sidebar='sidebar']":
            return node.attributes["data-sidebar"] === "sidebar";
          case "[data-slot='sidebar']":
            return node.attributes["data-slot"] === "sidebar";
          case "input, textarea, select, [contenteditable]":
            return (
              node.tagName === "INPUT" ||
              node.tagName === "TEXTAREA" ||
              node.tagName === "SELECT" ||
              node.isContentEditable
            );
          default:
            return false;
        }
      });
    }

    private findAncestor(predicate: (node: FakeHTMLElement) => boolean): FakeHTMLElement | null {
      if (predicate(this)) {
        return this;
      }
      return this.parent?.findAncestor(predicate) ?? null;
    }
  }

  class FakeHTMLInputElement extends FakeHTMLElement {
    constructor() {
      super("INPUT");
    }
  }

  class FakeHTMLTextAreaElement extends FakeHTMLElement {
    constructor() {
      super("TEXTAREA");
    }
  }

  class FakeHTMLSelectElement extends FakeHTMLElement {
    constructor() {
      super("SELECT");
    }
  }

  function withMockedElementGlobals(run: () => void) {
    const originals = {
      HTMLElement: globalThis.HTMLElement,
      HTMLInputElement: globalThis.HTMLInputElement,
      HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
      HTMLSelectElement: globalThis.HTMLSelectElement,
    };

    Object.assign(globalThis, {
      HTMLElement: FakeHTMLElement,
      HTMLInputElement: FakeHTMLInputElement,
      HTMLTextAreaElement: FakeHTMLTextAreaElement,
      HTMLSelectElement: FakeHTMLSelectElement,
    });

    try {
      run();
    } finally {
      Object.assign(globalThis, originals);
    }
  }

  it("returns true for editable elements inside the sidebar", () => {
    withMockedElementGlobals(() => {
      const sidebar = new FakeHTMLElement("DIV", { "data-sidebar": "sidebar" });
      const input = new FakeHTMLInputElement();
      input.parent = sidebar;

      expect(isTypingInSidebarTextEntry(input as unknown as EventTarget)).toBe(true);
    });
  });

  it("returns false for the composer contenteditable outside the sidebar", () => {
    withMockedElementGlobals(() => {
      const composer = new FakeHTMLElement("DIV");
      composer.isContentEditable = true;

      expect(isTypingInSidebarTextEntry(composer as unknown as EventTarget)).toBe(false);
    });
  });
});

describe("sidebar thread ordering", () => {
  const projects = [makeProject(PROJECT_A, "alpha"), makeProject(PROJECT_B, "beta")] as const;
  const threads = [
    makeThread(THREAD_A4, PROJECT_A, "2026-03-09T10:04:00.000Z"),
    makeThread(THREAD_A2, PROJECT_A, "2026-03-09T10:02:00.000Z"),
    makeThread(THREAD_A7, PROJECT_A, "2026-03-09T10:07:00.000Z"),
    makeThread(THREAD_A6, PROJECT_A, "2026-03-09T10:06:00.000Z"),
    makeThread(THREAD_A1, PROJECT_A, "2026-03-09T10:01:00.000Z"),
    makeThread(THREAD_A5, PROJECT_A, "2026-03-09T10:05:00.000Z"),
    makeThread(THREAD_A3, PROJECT_A, "2026-03-09T10:03:00.000Z"),
    makeThread(THREAD_B1, PROJECT_B, "2026-03-09T11:01:00.000Z"),
    makeThread(THREAD_B2, PROJECT_B, "2026-03-09T11:02:00.000Z"),
  ] as const;

  it("sorts project threads newest-first with id tie-breakers", () => {
    expect(
      sortThreadsForSidebar(PROJECT_A, [
        makeThread(THREAD_A1, PROJECT_A, "2026-03-09T10:00:00.000Z"),
        makeThread(THREAD_A3, PROJECT_A, "2026-03-09T10:00:00.000Z"),
        makeThread(THREAD_A2, PROJECT_A, "2026-03-09T10:01:00.000Z"),
      ]).map((thread) => thread.id),
    ).toEqual([THREAD_A2, THREAD_A3, THREAD_A1]);
  });

  it("limits visible threads when show more is collapsed", () => {
    const projectThreads = sortThreadsForSidebar(PROJECT_A, threads);
    expect(
      visibleThreadsForSidebar({
        projectThreads,
        isThreadListExpanded: false,
        threadPreviewLimit: 6,
      }).map((thread) => thread.id),
    ).toEqual([THREAD_A7, THREAD_A6, THREAD_A5, THREAD_A4, THREAD_A3, THREAD_A2]);
  });

  it("returns all threads when show more is expanded", () => {
    const projectThreads = sortThreadsForSidebar(PROJECT_A, threads);
    expect(
      visibleThreadsForSidebar({
        projectThreads,
        isThreadListExpanded: true,
        threadPreviewLimit: 6,
      }).map((thread) => thread.id),
    ).toEqual([THREAD_A7, THREAD_A6, THREAD_A5, THREAD_A4, THREAD_A3, THREAD_A2, THREAD_A1]);
  });

  it("derives visible thread ids in project order and skips collapsed projects", () => {
    expect(
      visibleThreadIdsForSidebar({
        projects: [projects[0], makeProject(PROJECT_B, "beta", false)],
        threads,
        expandedThreadListsByProject: new Set<Project["id"]>(),
        threadPreviewLimit: 6,
      }),
    ).toEqual([THREAD_A7, THREAD_A6, THREAD_A5, THREAD_A4, THREAD_A3, THREAD_A2]);
  });

  it("includes hidden threads only after show more is expanded", () => {
    expect(
      visibleThreadIdsForSidebar({
        projects,
        threads,
        expandedThreadListsByProject: new Set<Project["id"]>([PROJECT_A]),
        threadPreviewLimit: 6,
      }),
    ).toEqual([
      THREAD_A7,
      THREAD_A6,
      THREAD_A5,
      THREAD_A4,
      THREAD_A3,
      THREAD_A2,
      THREAD_A1,
      THREAD_B2,
      THREAD_B1,
    ]);
  });
});

describe("resolveSidebarThreadNavigationTarget", () => {
  const orderedVisibleThreadIds = [THREAD_A1, THREAD_A2, THREAD_B1] as const;

  it("moves to the previous thread from the middle", () => {
    expect(
      resolveSidebarThreadNavigationTarget({
        orderedVisibleThreadIds,
        currentThreadId: THREAD_A2,
        direction: "previous",
      }),
    ).toBe(THREAD_A1);
  });

  it("moves to the next thread from the middle", () => {
    expect(
      resolveSidebarThreadNavigationTarget({
        orderedVisibleThreadIds,
        currentThreadId: THREAD_A2,
        direction: "next",
      }),
    ).toBe(THREAD_B1);
  });

  it("returns null at the previous boundary", () => {
    expect(
      resolveSidebarThreadNavigationTarget({
        orderedVisibleThreadIds,
        currentThreadId: THREAD_A1,
        direction: "previous",
      }),
    ).toBeNull();
  });

  it("returns null at the next boundary", () => {
    expect(
      resolveSidebarThreadNavigationTarget({
        orderedVisibleThreadIds,
        currentThreadId: THREAD_B1,
        direction: "next",
      }),
    ).toBeNull();
  });

  it("falls back to the first thread for next when there is no active thread", () => {
    expect(
      resolveSidebarThreadNavigationTarget({
        orderedVisibleThreadIds,
        currentThreadId: null,
        direction: "next",
      }),
    ).toBe(THREAD_A1);
  });

  it("falls back to the last thread for previous when the active thread is hidden", () => {
    expect(
      resolveSidebarThreadNavigationTarget({
        orderedVisibleThreadIds,
        currentThreadId: THREAD_A7,
        direction: "previous",
      }),
    ).toBe(THREAD_B1);
  });
});

describe("projectNavigationTargetsForSidebar", () => {
  const projects = [
    makeProject(PROJECT_A, "alpha"),
    makeProject(PROJECT_B, "beta"),
    makeProject(ProjectId.makeUnsafe("project-empty"), "empty"),
  ] as const;
  const threads = [
    makeThread(THREAD_A1, PROJECT_A, "2026-03-09T10:01:00.000Z"),
    makeThread(THREAD_A2, PROJECT_A, "2026-03-09T10:02:00.000Z"),
    makeThread(THREAD_B1, PROJECT_B, "2026-03-09T11:01:00.000Z"),
  ] as const;

  it("returns newest thread targets in project order and skips empty projects", () => {
    expect(
      projectNavigationTargetsForSidebar({
        projects,
        threads,
      }),
    ).toEqual([
      { projectId: PROJECT_A, threadId: THREAD_A2 },
      { projectId: PROJECT_B, threadId: THREAD_B1 },
    ]);
  });
});

describe("resolveSidebarProjectNavigationTarget", () => {
  const orderedProjectTargets = [
    { projectId: PROJECT_A, threadId: THREAD_A2 },
    { projectId: PROJECT_B, threadId: THREAD_B1 },
  ] as const;

  it("moves to the previous project from the middle", () => {
    expect(
      resolveSidebarProjectNavigationTarget({
        orderedProjectTargets,
        currentProjectId: PROJECT_B,
        direction: "previous",
      }),
    ).toEqual({ projectId: PROJECT_A, threadId: THREAD_A2 });
  });

  it("returns null at the previous boundary", () => {
    expect(
      resolveSidebarProjectNavigationTarget({
        orderedProjectTargets,
        currentProjectId: PROJECT_A,
        direction: "previous",
      }),
    ).toBeNull();
  });

  it("falls back to the first project when there is no active project", () => {
    expect(
      resolveSidebarProjectNavigationTarget({
        orderedProjectTargets,
        currentProjectId: null,
        direction: "next",
      }),
    ).toEqual({ projectId: PROJECT_A, threadId: THREAD_A2 });
  });

  it("falls back to the last project when the active project is missing", () => {
    expect(
      resolveSidebarProjectNavigationTarget({
        orderedProjectTargets,
        currentProjectId: ProjectId.makeUnsafe("project-missing"),
        direction: "previous",
      }),
    ).toEqual({ projectId: PROJECT_B, threadId: THREAD_B1 });
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: null,
              implementationThreadId: null,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not show plan ready after the proposed plan was implemented elsewhere", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: "2026-03-09T10:06:00.000Z",
              implementationThreadId: "thread-implement" as never,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the darker selected palette when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-primary/22");
    expect(className).toContain("hover:bg-primary/26");
    expect(className).toContain("dark:bg-primary/30");
    expect(className).not.toContain("bg-accent/85");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-primary/15");
    expect(className).toContain("hover:bg-primary/19");
    expect(className).toContain("dark:bg-primary/22");
    expect(className).not.toContain("hover:bg-accent");
  });

  it("keeps the accent palette for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-accent/85");
    expect(className).toContain("hover:bg-accent");
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        },
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});
