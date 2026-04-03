import "../index.css";

import { ProjectId, ThreadId, type MessageId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

import { useStore } from "../store";
import type { Project, Thread } from "../types";
import { GlobalThreadSearchDialog } from "./GlobalThreadSearchDialog";

const PROJECT_ID = ProjectId.makeUnsafe("project-thread-search");
const THREAD_ID = ThreadId.makeUnsafe("thread-thread-search");
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

function makeThread(): Thread {
  return {
    id: THREAD_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Cross-thread assistant result",
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [
      {
        id: "msg-user-1" as MessageId,
        role: "user",
        text: "Header Needle Destination",
        createdAt: "2026-03-16T12:04:00.000Z",
        completedAt: "2026-03-16T12:04:00.000Z",
        streaming: false,
      },
      {
        id: "msg-assistant-1" as MessageId,
        role: "assistant",
        text: "Cross-thread assistant result",
        createdAt: "2026-03-16T12:05:00.000Z",
        completedAt: "2026-03-16T12:05:00.000Z",
        streaming: false,
      },
    ],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-16T12:00:00.000Z",
    archivedAt: null,
    updatedAt: NOW_ISO,
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
    threads: [makeThread()],
  });

  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <GlobalThreadSearchDialog
      open
      onOpenChange={() => {}}
      activeThreadId={THREAD_ID}
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

describe("GlobalThreadSearchDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    useStore.setState({
      projects: [],
      threads: [],
    });
  });

  it("shows relative timestamps with exact titles in search results", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(NOW_ISO));
    const mounted = await mountDialog();

    try {
      const input = page.getByTestId("global-thread-search-input");
      await input.fill("assistant");

      await vi.waitFor(() => {
        const result = document.querySelector<HTMLElement>("[data-global-thread-search-result]");
        expect(result?.textContent).toContain("Cross-thread assistant result");
        expect(result?.textContent).toContain("Assistant");
        expect(result?.textContent).toContain("Project");
        expect(result?.textContent).toContain("5 minutes ago");

        const relativeTimestamp = result?.querySelector<HTMLElement>("[title]");
        expect(relativeTimestamp?.textContent).toBe("5 minutes ago");
        expect(relativeTimestamp?.getAttribute("title")).toBeTruthy();
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
