import "../index.css";

import { ProjectId, ThreadId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

let mockedSidebarProjectSortOrder: "updated_at" | "manual" = "updated_at";

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
    useQueries: () => [],
  };
});

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({
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
  useServerKeybindings: () => [],
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

vi.mock("./sidebar/SidebarUpdatePill", () => ({
  SidebarUpdatePill: () => null,
}));

import AppSidebar from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";
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
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
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

async function mountSidebar(options?: { projectOrder?: ProjectId[] }) {
  const projects = [
    makeProject(PROJECT_ALPHA, "Alpha", "/repo/alpha"),
    makeProject(PROJECT_BETA, "Beta", "/repo/beta"),
  ];
  const threads = buildThreads();

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
    selectedThreadIds: new Set(),
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
});
