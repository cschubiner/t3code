import "../index.css";

import { ProjectId, ThreadId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { GitStatusResult } from "@t3tools/contracts";

let mockedSidebarProjectSortOrder: "updated_at" | "manual" = "updated_at";
let desktopMenuActionListener: ((action: string) => void) | null = null;
let mockedKeybindings: ResolvedKeybindingsConfig = [];
let mockedGitStatusByCwd = new Map<string, GitStatusResult>();
let mockedReferencedPrStateByUrl = new Map<string, "open" | "closed" | "merged" | null>();
let mockedReferencedPrStateByTarget = new Map<string, "open" | "closed" | "merged" | null>();
let mockedUseQueriesQueryKeys: Array<readonly unknown[]> = [];

function referencedPrTargetKey(candidateCwds: readonly unknown[], url: string): string {
  return `${candidateCwds.filter((cwd): cwd is string => typeof cwd === "string").join("::")}::${url}`;
}

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: ({ select }: { select: (location: { pathname: string }) => string }) =>
      select({ pathname: "/" }),
    useParams: ({ select }: { select: (params: { threadId?: string }) => unknown }) => select({}),
  };
});

vi.mock("@tanstack/react-query", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueries: ({ queries }: { queries: Array<{ queryKey: readonly unknown[] }> }) => {
      mockedUseQueriesQueryKeys.push(...queries.map((query) => query.queryKey));
      return queries.map((query) => {
        const [scope, key, third] = query.queryKey;
        if (scope === "git" && key === "status" && typeof third === "string") {
          return { data: mockedGitStatusByCwd.get(third) };
        }
        if (scope === "github-pr-status" && Array.isArray(key) && typeof third === "string") {
          return {
            data:
              mockedReferencedPrStateByTarget.get(referencedPrTargetKey(key, third)) ??
              mockedReferencedPrStateByUrl.get(third) ??
              null,
          };
        }
        return { data: undefined };
      });
    },
  };
});

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    sidebarProjectSortOrder: mockedSidebarProjectSortOrder,
    sidebarThreadSortOrder: "updated_at",
    defaultThreadEnvMode: "local",
    confirmThreadArchive: true,
    confirmThreadDelete: true,
  }),
  useUpdateSettings: () => ({
    updateSettings: vi.fn(),
  }),
}));

vi.mock("../rpc/serverState", () => ({
  useServerKeybindings: () => mockedKeybindings,
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: () => null,
  ensureNativeApi: () => {
    throw new Error("Native API not available in Sidebar browser test");
  },
  __resetNativeApiForTests: () => undefined,
}));

vi.mock("../hooks/useHandleNewThread", () => ({
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
    handleNewThread: vi.fn(),
  }),
}));

vi.mock("../hooks/useThreadActions", () => ({
  useThreadActions: () => ({
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
  }),
}));

vi.mock("./ProjectFavicon", () => ({
  ProjectFavicon: () => <div data-testid="project-favicon" />,
}));

vi.mock("./GlobalThreadSearchDialog", () => ({
  GlobalThreadSearchDialog: () => null,
}));

vi.mock("./ProjectFolderSearchDialog", () => ({
  ProjectFolderSearchDialog: () => null,
}));

vi.mock("./ImportFromCodexDialog", () => ({
  ImportFromCodexDialog: () => null,
}));

vi.mock("./sidebar/SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
}));

import AppSidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";
import { isMacPlatform } from "../lib/utils";
import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";
import type { Project, SidebarThreadSummary, Thread } from "../types";

const NOW_ISO = "2026-04-02T12:00:00.000Z";
const PROJECT_ALPHA = ProjectId.makeUnsafe("project-alpha");
const PROJECT_BETA = ProjectId.makeUnsafe("project-beta");

function makeProject(id: ProjectId, name: string, cwd: string): Project {
  return {
    id,
    name,
    cwd,
    defaultModelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    scripts: [],
  };
}

function makeThread(input: {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: Thread["messages"];
  branch?: string | null;
  worktreePath?: string | null;
}): Thread {
  return {
    id: input.id,
    codexThreadId: null,
    projectId: input.projectId,
    title: input.title,
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: input.messages ?? [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    archivedAt: null,
    latestTurn: null,
    branch: input.branch ?? null,
    worktreePath: input.worktreePath ?? null,
  };
}

function makeSidebarThreadSummary(thread: Thread): SidebarThreadSummary {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session: thread.session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function buildThreads(): Thread[] {
  return [
    makeThread({
      id: ThreadId.makeUnsafe("thread-1"),
      projectId: PROJECT_ALPHA,
      title: "Alpha oldest",
      createdAt: "2026-04-02T11:00:00.000Z",
      updatedAt: "2026-04-02T11:01:00.000Z",
    }),
    makeThread({
      id: ThreadId.makeUnsafe("thread-2"),
      projectId: PROJECT_ALPHA,
      title: "Alpha recent",
      createdAt: "2026-04-02T11:02:00.000Z",
      updatedAt: "2026-04-02T11:08:00.000Z",
    }),
    makeThread({
      id: ThreadId.makeUnsafe("thread-3"),
      projectId: PROJECT_BETA,
      title: "Beta recent",
      createdAt: "2026-04-02T11:03:00.000Z",
      updatedAt: "2026-04-02T11:09:00.000Z",
    }),
    makeThread({
      id: ThreadId.makeUnsafe("thread-4"),
      projectId: PROJECT_ALPHA,
      title: "Alpha newest",
      createdAt: "2026-04-02T11:04:00.000Z",
      updatedAt: "2026-04-02T11:10:00.000Z",
    }),
    makeThread({
      id: ThreadId.makeUnsafe("thread-5"),
      projectId: PROJECT_BETA,
      title: "Beta mid",
      createdAt: "2026-04-02T11:05:00.000Z",
      updatedAt: "2026-04-02T11:07:00.000Z",
    }),
    makeThread({
      id: ThreadId.makeUnsafe("thread-6"),
      projectId: PROJECT_ALPHA,
      title: "Alpha later",
      createdAt: "2026-04-02T11:06:00.000Z",
      updatedAt: "2026-04-02T11:06:30.000Z",
    }),
    makeThread({
      id: ThreadId.makeUnsafe("thread-7"),
      projectId: PROJECT_BETA,
      title: "Beta hidden until expand",
      createdAt: "2026-04-02T11:07:00.000Z",
      updatedAt: "2026-04-02T11:05:00.000Z",
    }),
  ];
}

async function mountSidebar(options?: {
  projectOrder?: ProjectId[];
  selectedThreadIds?: ReadonlySet<ThreadId>;
  threads?: Thread[];
  projects?: Project[];
}) {
  const projects = options?.projects ?? [
    makeProject(PROJECT_ALPHA, "Alpha", "/repo/alpha"),
    makeProject(PROJECT_BETA, "Beta", "/repo/beta"),
  ];
  const threads = options?.threads ?? buildThreads();

  useStore.setState({
    projects,
    threads,
    sidebarThreadsById: Object.fromEntries(
      threads.map((thread) => [thread.id, makeSidebarThreadSummary(thread)]),
    ),
    threadIdsByProjectId: {
      [PROJECT_ALPHA]: threads
        .filter((thread) => thread.projectId === PROJECT_ALPHA)
        .map((thread) => thread.id),
      [PROJECT_BETA]: threads
        .filter((thread) => thread.projectId === PROJECT_BETA)
        .map((thread) => thread.id),
    },
    bootstrapComplete: true,
    sidebarThreadListMode: "recent",
  });
  useUiStateStore.setState({
    projectExpandedById: {
      [PROJECT_ALPHA]: true,
      [PROJECT_BETA]: true,
    },
    projectOrder: options?.projectOrder ?? [PROJECT_ALPHA, PROJECT_BETA],
    threadLastVisitedAtById: {},
  });
  useComposerDraftStore.setState({
    projectDraftThreadIdByProjectId: {},
    draftThreadsByThreadId: {},
  });
  useTerminalStateStore.setState({
    terminalStateByThreadId: {},
  });
  useThreadSelectionStore.setState({
    selectedThreadIds: new Set(options?.selectedThreadIds ?? []),
    anchorThreadId: null,
  });

  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("Sidebar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    localStorage.clear();
    mockedSidebarProjectSortOrder = "updated_at";
    mockedKeybindings = [];
    mockedGitStatusByCwd = new Map();
    mockedReferencedPrStateByUrl = new Map();
    mockedReferencedPrStateByTarget = new Map();
    mockedUseQueriesQueryKeys = [];
    desktopMenuActionListener = null;
    Reflect.deleteProperty(window, "desktopBridge");
    useStore.setState({
      projects: [],
      threads: [],
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: false,
      sidebarThreadListMode: "grouped",
    });
    useUiStateStore.setState({
      projectExpandedById: {},
      projectOrder: [],
      threadLastVisitedAtById: {},
    });
    useComposerDraftStore.setState({
      projectDraftThreadIdByProjectId: {},
      draftThreadsByThreadId: {},
    });
    useTerminalStateStore.setState({
      terminalStateByThreadId: {},
    });
    useThreadSelectionStore.setState({
      selectedThreadIds: new Set(),
      anchorThreadId: null,
    });
  });

  it("shows a global recent thread list with project labels and expandable overflow", async () => {
    const mounted = await mountSidebar();

    try {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="thread-row-thread-4"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="thread-row-thread-1"]')).toBeFalsy();
      });

      const bodyText = document.body.textContent ?? "";
      expect(bodyText).toContain("Alpha newest");
      expect(bodyText).toContain("Beta recent");
      expect(bodyText).toContain("Alpha");
      expect(bodyText).toContain("Beta");
      expect(bodyText).toContain("Show more");

      await page.getByText("Show more").click();

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="thread-row-thread-1"]')).toBeTruthy();
        expect(document.body.textContent).toContain("Show less");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("switches between recent and grouped list modes", async () => {
    const mounted = await mountSidebar();

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Show more");
      });

      await page.getByRole("button", { name: "Grouped threads" }).click();

      await vi.waitFor(() => {
        expect(useStore.getState().sidebarThreadListMode).toBe("grouped");
        expect(document.body.textContent).not.toContain("Show more");
        expect(
          document.querySelector('button[aria-label="Create new thread in Alpha"]'),
        ).toBeTruthy();
        expect(
          document.querySelector('button[aria-label="Create new thread in Beta"]'),
        ).toBeTruthy();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders grouped projects in manual order when manual sorting is enabled", async () => {
    mockedSidebarProjectSortOrder = "manual";
    const mounted = await mountSidebar({ projectOrder: [PROJECT_BETA, PROJECT_ALPHA] });

    try {
      await page.getByRole("button", { name: "Grouped threads" }).click();

      await vi.waitFor(() => {
        const projectButtons = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            'button[aria-label^="Create new thread in "]',
          ),
        ).map((button) => button.getAttribute("aria-label"));

        expect(projectButtons).toEqual(["Create new thread in Beta", "Create new thread in Alpha"]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("routes sidebar history shortcuts to browser navigation", async () => {
    mockedKeybindings = [
      {
        shortcut: {
          key: "[",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        command: "sidebar.history.previous",
      },
      {
        shortcut: {
          key: "]",
          modKey: true,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
        },
        command: "sidebar.history.next",
      },
    ];
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const forwardSpy = vi.spyOn(window.history, "forward").mockImplementation(() => undefined);
    const mounted = await mountSidebar();
    const useMetaForMod = isMacPlatform(navigator.platform);

    try {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "[",
          code: "BracketLeft",
          metaKey: useMetaForMod,
          ctrlKey: !useMetaForMod,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "]",
          code: "BracketRight",
          metaKey: useMetaForMod,
          ctrlKey: !useMetaForMod,
        }),
      );

      await vi.waitFor(() => {
        expect(backSpy).toHaveBeenCalledTimes(1);
        expect(forwardSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens rename from the desktop sidebar menu action", async () => {
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: {
        onMenuAction: (listener: (action: string) => void) => {
          desktopMenuActionListener = listener;
          return () => {
            if (desktopMenuActionListener === listener) {
              desktopMenuActionListener = null;
            }
          };
        },
      },
    });

    const mounted = await mountSidebar({
      selectedThreadIds: new Set([ThreadId.makeUnsafe("thread-2")]),
    });

    try {
      await vi.waitFor(() => {
        expect(desktopMenuActionListener).toBeTypeOf("function");
      });

      desktopMenuActionListener?.("sidebar.rename");

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="thread-row-thread-2"] input')).toBeTruthy();
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders referenced PR number pills with open, merged, and closed colors", async () => {
    mockedReferencedPrStateByUrl = new Map([
      ["https://github.com/pingdotgg/t3code/pull/88", "open"],
      ["https://github.com/pingdotgg/t3code/pull/89", "merged"],
      ["https://github.com/pingdotgg/t3code/pull/90", "closed"],
    ]);

    const project = makeProject(PROJECT_ALPHA, "Alpha", "/repo/alpha");
    const thread = makeThread({
      id: ThreadId.makeUnsafe("thread-pr-pills"),
      projectId: PROJECT_ALPHA,
      title: "PR pills",
      createdAt: "2026-04-02T11:11:00.000Z",
      updatedAt: "2026-04-02T11:11:00.000Z",
      branch: "feature/pr-pills",
      worktreePath: "/repo/alpha-worktree",
      messages: [
        {
          id: "message-pr-pills" as never,
          role: "assistant",
          text: `
            https://github.com/pingdotgg/t3code/pull/88/files
            https://github.com/pingdotgg/t3code/pull/89#pullrequestreview-12
            <https://github.com/pingdotgg/t3code/pull/90|PR 90>
          `,
          createdAt: "2026-04-02T11:11:00.000Z",
          streaming: false,
        },
      ],
    });

    const mounted = await mountSidebar({
      projects: [project],
      threads: [thread],
    });

    try {
      await vi.waitFor(() => {
        const openPill = Array.from(document.querySelectorAll("button")).find(
          (element) => element.textContent?.trim() === "#88",
        );
        const mergedPill = Array.from(document.querySelectorAll("button")).find(
          (element) => element.textContent?.trim() === "#89",
        );
        const closedPill = Array.from(document.querySelectorAll("button")).find(
          (element) => element.textContent?.trim() === "#90",
        );

        expect(openPill?.className).toContain("text-emerald-700");
        expect(mergedPill?.className).toContain("text-violet-700");
        expect(closedPill?.className).toContain("text-rose-700");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("only queries PR status for threads visible in the recent sidebar list", async () => {
    const threads = Array.from({ length: 7 }, (_, index) =>
      makeThread({
        id: ThreadId.makeUnsafe(`thread-pr-${index + 1}`),
        projectId: PROJECT_ALPHA,
        title: `PR thread ${index + 1}`,
        createdAt: `2026-04-02T11:0${index}:00.000Z`,
        updatedAt: `2026-04-02T11:0${index}:30.000Z`,
        branch: `feature/pr-${index + 1}`,
        worktreePath: `/repo/alpha-worktree-${index + 1}`,
        messages: [
          {
            id: `message-pr-${index + 1}` as never,
            role: "assistant",
            text: `https://github.com/pingdotgg/t3code/pull/${index + 101}`,
            createdAt: `2026-04-02T11:0${index}:30.000Z`,
            streaming: false,
          },
        ],
      }),
    );

    const mounted = await mountSidebar({
      projects: [makeProject(PROJECT_ALPHA, "Alpha", "/repo/alpha")],
      threads,
    });

    try {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="thread-row-thread-pr-7"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="thread-row-thread-pr-2"]')).toBeTruthy();
        expect(document.querySelector('[data-testid="thread-row-thread-pr-1"]')).toBeFalsy();
      });

      const referencedPrQueryUrls = new Set(
        mockedUseQueriesQueryKeys
          .filter((queryKey) => queryKey[0] === "github-pr-status")
          .map((queryKey) => queryKey[2])
          .filter((url): url is string => typeof url === "string"),
      );

      expect(referencedPrQueryUrls).toContain("https://github.com/pingdotgg/t3code/pull/107");
      expect(referencedPrQueryUrls).toContain("https://github.com/pingdotgg/t3code/pull/102");
      expect(referencedPrQueryUrls).not.toContain("https://github.com/pingdotgg/t3code/pull/101");
    } finally {
      await mounted.cleanup();
    }
  });

  it("resolves referenced PR state from the project root when the worktree path is stale", async () => {
    const prUrl = "https://github.com/pingdotgg/t3code/pull/222";
    const staleWorktreePath = "/repo/alpha-stale-worktree";
    const projectRootPath = "/repo/alpha";
    mockedReferencedPrStateByTarget = new Map([
      [referencedPrTargetKey([staleWorktreePath, projectRootPath], prUrl), "closed"],
    ]);

    const thread = makeThread({
      id: ThreadId.makeUnsafe("thread-pr-stale-worktree"),
      projectId: PROJECT_ALPHA,
      title: "Stale worktree PR reference",
      createdAt: "2026-04-02T11:12:00.000Z",
      updatedAt: "2026-04-02T11:12:00.000Z",
      branch: "feature/stale-worktree",
      worktreePath: staleWorktreePath,
      messages: [
        {
          id: "message-pr-stale-worktree" as never,
          role: "assistant",
          text: `${prUrl}/files`,
          createdAt: "2026-04-02T11:12:00.000Z",
          streaming: false,
        },
      ],
    });

    const mounted = await mountSidebar({
      projects: [makeProject(PROJECT_ALPHA, "Alpha", projectRootPath)],
      threads: [thread],
    });

    try {
      await vi.waitFor(() => {
        const closedPill = Array.from(document.querySelectorAll("button")).find(
          (element) => element.textContent?.trim() === "#222",
        );

        expect(closedPill?.className).toContain("text-rose-700");
        expect(mockedUseQueriesQueryKeys).toContainEqual([
          "github-pr-status",
          [staleWorktreePath, projectRootPath],
          prUrl,
        ]);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("deduplicates referenced PR status queries across visible threads", async () => {
    const prUrl = "https://github.com/pingdotgg/t3code/pull/333";
    mockedReferencedPrStateByUrl = new Map([[prUrl, "merged"]]);

    const sharedMessage = {
      role: "assistant" as const,
      text: `${prUrl}/files`,
      streaming: false,
    };

    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-pr-dedupe-1"),
        projectId: PROJECT_ALPHA,
        title: "Shared PR 1",
        createdAt: "2026-04-02T11:13:00.000Z",
        updatedAt: "2026-04-02T11:13:00.000Z",
        branch: "feature/shared-pr-1",
        worktreePath: "/repo/alpha-worktree-shared",
        messages: [
          {
            id: "message-pr-dedupe-1" as never,
            createdAt: "2026-04-02T11:13:00.000Z",
            ...sharedMessage,
          },
        ],
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-pr-dedupe-2"),
        projectId: PROJECT_ALPHA,
        title: "Shared PR 2",
        createdAt: "2026-04-02T11:14:00.000Z",
        updatedAt: "2026-04-02T11:14:00.000Z",
        branch: "feature/shared-pr-2",
        worktreePath: "/repo/alpha-worktree-shared",
        messages: [
          {
            id: "message-pr-dedupe-2" as never,
            createdAt: "2026-04-02T11:14:00.000Z",
            ...sharedMessage,
          },
        ],
      }),
    ];

    const mounted = await mountSidebar({
      projects: [makeProject(PROJECT_ALPHA, "Alpha", "/repo/alpha")],
      threads,
    });

    try {
      await vi.waitFor(() => {
        const referencedPrQueries = mockedUseQueriesQueryKeys.filter(
          (queryKey) => queryKey[0] === "github-pr-status",
        );

        expect(referencedPrQueries).toHaveLength(1);
        expect(referencedPrQueries[0]).toEqual([
          "github-pr-status",
          ["/repo/alpha-worktree-shared", "/repo/alpha"],
          prUrl,
        ]);
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
