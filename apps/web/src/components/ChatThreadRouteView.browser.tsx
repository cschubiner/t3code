import "../index.css";

import { ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

let currentThreadId = ThreadId.makeUnsafe("thread-route-1");
const navigateSpy = vi.fn();
const setOpenMobileSpy = vi.fn();
let sidebarState = {
  isMobile: true,
  openMobile: false,
  setOpenMobile: setOpenMobileSpy,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: ({ select }: { select: (params: { threadId: string }) => unknown }) =>
      select({ threadId: currentThreadId }),
    useSearch: () => ({ diff: undefined }),
  }),
  retainSearchParams: () => undefined,
  useNavigate: () => navigateSpy,
}));

vi.mock("../components/ChatView", () => ({
  default: ({ threadId }: { threadId: ThreadId }) => (
    <div data-testid="chat-thread-view">{threadId}</div>
  ),
}));

vi.mock("../components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../components/DiffPanel", () => ({
  default: () => <div data-testid="diff-panel" />,
}));

vi.mock("../components/DiffPanelShell", () => ({
  DiffPanelHeaderSkeleton: () => <div data-testid="diff-header-skeleton" />,
  DiffPanelLoadingState: ({ label }: { label: string }) => <div>{label}</div>,
  DiffPanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("~/components/ui/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarRail: () => <div data-testid="sidebar-rail" />,
  useSidebar: () => sidebarState,
}));

import { useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { ChatThreadRouteView } from "../routes/_chat.$threadId";

const PROJECT_ID = ProjectId.makeUnsafe("project-route");
const THREAD_ID_ONE = ThreadId.makeUnsafe("thread-route-1");
const THREAD_ID_TWO = ThreadId.makeUnsafe("thread-route-2");

function seedThreadState() {
  useStore.setState({
    projects: [
      {
        id: PROJECT_ID,
        name: "Project",
        cwd: "/repo/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        createdAt: "2026-04-02T12:00:00.000Z",
        updatedAt: "2026-04-02T12:00:00.000Z",
        scripts: [],
      },
    ],
    threads: [
      {
        id: THREAD_ID_ONE,
        codexThreadId: null,
        projectId: PROJECT_ID,
        title: "Thread One",
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
        createdAt: "2026-04-02T12:00:00.000Z",
        updatedAt: "2026-04-02T12:00:00.000Z",
        archivedAt: null,
        latestTurn: null,
        branch: null,
        worktreePath: null,
      },
      {
        id: THREAD_ID_TWO,
        codexThreadId: null,
        projectId: PROJECT_ID,
        title: "Thread Two",
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
        createdAt: "2026-04-02T12:01:00.000Z",
        updatedAt: "2026-04-02T12:01:00.000Z",
        archivedAt: null,
        latestTurn: null,
        branch: null,
        worktreePath: null,
      },
    ],
    sidebarThreadsById: {},
    threadIdsByProjectId: {
      [PROJECT_ID]: [THREAD_ID_ONE, THREAD_ID_TWO],
    },
    bootstrapComplete: true,
    sidebarThreadListMode: "grouped",
  });
  useComposerDraftStore.setState({
    projectDraftThreadIdByProjectId: {},
    draftThreadsByThreadId: {},
  });
}

describe("ChatThreadRouteView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    currentThreadId = THREAD_ID_ONE;
    navigateSpy.mockReset();
    setOpenMobileSpy.mockReset();
    sidebarState = {
      isMobile: true,
      openMobile: false,
      setOpenMobile: setOpenMobileSpy,
    };
    useStore.setState({
      projects: [],
      threads: [],
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: false,
      sidebarThreadListMode: "grouped",
    });
    useComposerDraftStore.setState({
      projectDraftThreadIdByProjectId: {},
      draftThreadsByThreadId: {},
    });
  });

  it("closes the mobile drawer after thread selection changes while it is open", async () => {
    seedThreadState();

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<ChatThreadRouteView />, { container: host });

    try {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="chat-thread-view"]')?.textContent).toBe(
          THREAD_ID_ONE,
        );
      });
      expect(setOpenMobileSpy).not.toHaveBeenCalled();

      currentThreadId = THREAD_ID_TWO;
      sidebarState = {
        isMobile: true,
        openMobile: true,
        setOpenMobile: setOpenMobileSpy,
      };

      await screen.rerender(<ChatThreadRouteView />);

      await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="chat-thread-view"]')?.textContent).toBe(
          THREAD_ID_TWO,
        );
        expect(setOpenMobileSpy).toHaveBeenCalledWith(false);
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
