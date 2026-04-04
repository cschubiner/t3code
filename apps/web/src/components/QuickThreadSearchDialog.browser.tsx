import "../index.css";

import { ProjectId, ThreadId, type MessageId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { useStore } from "../store";
import type { Project, Thread } from "../types";
import { QuickThreadSearchDialog } from "./QuickThreadSearchDialog";

const PROJECT_ID = ProjectId.makeUnsafe("project-thread-search");
const NOW_ISO = "2026-03-16T12:10:00.000Z";

function makeProject(): Project {
  return {
    id: PROJECT_ID,
    name: "Project",
    cwd: "/repo/project",
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
  id: string;
  title: string;
  userText: string;
  updatedAt: string;
}): Thread {
  return {
    id: ThreadId.makeUnsafe(input.id),
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: input.title,
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [
      {
        id: `${input.id}-msg-user` as MessageId,
        role: "user",
        text: input.userText,
        createdAt: input.updatedAt,
        completedAt: input.updatedAt,
        streaming: false,
      },
    ],
    proposedPlans: [],
    error: null,
    createdAt: input.updatedAt,
    archivedAt: null,
    updatedAt: input.updatedAt,
    latestTurn: null,
    branch: "main",
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

async function mountDialog() {
  useStore.setState({
    projects: [makeProject()],
    threads: [
      makeThread({
        id: "thread-title",
        title: "Needle title match",
        userText: "ordinary kickoff",
        updatedAt: "2026-03-16T12:05:00.000Z",
      }),
      makeThread({
        id: "thread-message",
        title: "Shipping thread",
        userText: "needle opening prompt",
        updatedAt: "2026-03-16T12:09:00.000Z",
      }),
    ],
  });

  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <QuickThreadSearchDialog
      open
      onOpenChange={() => {}}
      activeThreadId={null}
      focusRequestId={1}
    />,
    { container: host },
  );

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("QuickThreadSearchDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    navigateMock.mockReset();
    document.body.innerHTML = "";
    useStore.setState({
      projects: [],
      threads: [],
    });
  });

  it("shows the empty prompt before a query is entered", async () => {
    const mounted = await mountDialog();

    try {
      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Start typing to search the 100 most recent");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("prefers a title match over a newer first-message-only match", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(NOW_ISO));
    const mounted = await mountDialog();

    try {
      const input = page.getByTestId("quick-thread-search-input");
      await input.fill("needle");

      await vi.waitFor(() => {
        const results = Array.from(
          document.querySelectorAll<HTMLElement>("[data-global-thread-search-result]"),
        );
        expect(results).toHaveLength(2);
        expect(results[0]?.textContent).toContain("Needle title match");
        expect(results[0]?.textContent).toContain("Title");
        expect(results[0]?.textContent).toContain("Project");
        expect(results[0]?.textContent).toContain("5 minutes ago");
        expect(results[1]?.textContent).toContain("Shipping thread");
        expect(results[1]?.textContent).toContain("User");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows a no-results state for unmatched queries", async () => {
    const mounted = await mountDialog();

    try {
      const input = page.getByTestId("quick-thread-search-input");
      await input.fill("missing-query");

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("No recent threads matched this search.");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the highlighted result with keyboard enter", async () => {
    const onOpenChange = vi.fn();
    useStore.setState({
      projects: [makeProject()],
      threads: [
        makeThread({
          id: "thread-title",
          title: "Needle title match",
          userText: "ordinary kickoff",
          updatedAt: "2026-03-16T12:05:00.000Z",
        }),
      ],
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <QuickThreadSearchDialog
        open
        onOpenChange={onOpenChange}
        activeThreadId={null}
        focusRequestId={1}
      />,
      { container: host },
    );

    try {
      const input = page.getByTestId("quick-thread-search-input");
      await input.fill("needle");

      await vi.waitFor(() => {
        const results = Array.from(
          document.querySelectorAll<HTMLElement>("[data-global-thread-search-result]"),
        );
        expect(results).toHaveLength(1);
        expect(results[0]?.dataset.highlighted).toBe("true");
      });

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const inputElement = document.querySelector<HTMLInputElement>(
        '[data-testid="quick-thread-search-input"]',
      );
      inputElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          code: "Enter",
        }),
      );

      await vi.waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(navigateMock).toHaveBeenCalledWith({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe("thread-title") },
        });
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
