import "../index.css";

import {
  ApprovalRequestId,
  EventId,
  type NativeApi,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../nativeApi";
import { useQueuedTurnStore } from "../queuedTurnStore";
import { useStore } from "../store";
import type { Thread } from "../types";
import { QueuedTurnBackgroundDispatcher } from "./QueuedTurnBackgroundDispatcher";

const PROJECT_ID = ProjectId.makeUnsafe("project-background-dispatcher");
const ACTIVE_THREAD_ID = ThreadId.makeUnsafe("thread-active");
const BACKGROUND_THREAD_ID = ThreadId.makeUnsafe("thread-background");

function makeThread(threadId: ThreadId, overrides?: Partial<Thread>): Thread {
  return {
    ...makeThreadBase(threadId),
    ...overrides,
  };
}

function makeThreadBase(threadId: ThreadId): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: `Thread ${threadId}`,
    modelSelection: {
      provider: "codex" as const,
      model: "gpt-5",
    },
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    session: {
      provider: "codex" as const,
      status: "ready" as const,
      orchestrationStatus: "idle" as const,
      createdAt: "2026-04-05T12:00:00.000Z",
      updatedAt: "2026-04-05T12:00:00.000Z",
    },
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-05T12:00:00.000Z",
    updatedAt: "2026-04-05T12:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
  };
}

function makeApprovalRequestedActivity(): Thread["activities"][number] {
  return {
    id: EventId.makeUnsafe("event-approval-requested"),
    tone: "approval" as const,
    kind: "approval.requested",
    summary: "Command approval requested",
    payload: {
      requestId: ApprovalRequestId.makeUnsafe("approval-request-1"),
      requestKind: "command" as const,
    },
    turnId: null,
    createdAt: "2026-04-05T12:00:30.000Z",
  };
}

describe("QueuedTurnBackgroundDispatcher", () => {
  beforeEach(async () => {
    __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
    useQueuedTurnStore.setState({
      threadsByThreadId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      sidebarThreadsById: {},
      threadIdsByProjectId: {},
      bootstrapComplete: true,
      sidebarThreadListMode: "grouped",
    });
    await useQueuedTurnStore.persist.rehydrate();
  });

  afterEach(() => {
    __resetNativeApiForTests();
    document.body.innerHTML = "";
    delete window.nativeApi;
  });

  it("dispatches queued turns for inactive threads without draining past the local-dispatch lock", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    window.nativeApi = {
      orchestration: {
        dispatchCommand,
      },
    } as unknown as NativeApi;

    useStore.setState({
      threads: [makeThread(ACTIVE_THREAD_ID), makeThread(BACKGROUND_THREAD_ID)],
    });

    useQueuedTurnStore.getState().enqueueTurn(BACKGROUND_THREAD_ID, {
      id: "queued-background-1",
      text: "First background queued follow-up",
      attachments: [],
      terminalContexts: [],
      modelSelection: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-05T12:01:00.000Z",
      updatedAt: "2026-04-05T12:01:00.000Z",
    });
    useQueuedTurnStore.getState().enqueueTurn(BACKGROUND_THREAD_ID, {
      id: "queued-background-2",
      text: "Second background queued follow-up",
      attachments: [],
      terminalContexts: [],
      modelSelection: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-05T12:02:00.000Z",
      updatedAt: "2026-04-05T12:02:00.000Z",
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <QueuedTurnBackgroundDispatcher activeThreadId={ACTIVE_THREAD_ID} />,
      { container: host },
    );

    try {
      await vi.waitFor(() => {
        expect(dispatchCommand).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "thread.turn.start",
            threadId: BACKGROUND_THREAD_ID,
            message: expect.objectContaining({
              text: "First background queued follow-up",
            }),
          }),
        );
        expect(
          useQueuedTurnStore
            .getState()
            .threadsByThreadId[BACKGROUND_THREAD_ID]?.items.map((item) => item.text),
        ).toEqual(["Second background queued follow-up"]);
      });

      await new Promise((resolve) => window.setTimeout(resolve, 50));
      expect(dispatchCommand).toHaveBeenCalledTimes(1);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("ignores queued turns that belong to the active thread", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    window.nativeApi = {
      orchestration: {
        dispatchCommand,
      },
    } as unknown as NativeApi;

    useStore.setState({
      threads: [makeThread(ACTIVE_THREAD_ID)],
    });

    useQueuedTurnStore.getState().enqueueTurn(ACTIVE_THREAD_ID, {
      id: "queued-active-1",
      text: "Should stay queued on the active thread",
      attachments: [],
      terminalContexts: [],
      modelSelection: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-05T12:03:00.000Z",
      updatedAt: "2026-04-05T12:03:00.000Z",
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <QueuedTurnBackgroundDispatcher activeThreadId={ACTIVE_THREAD_ID} />,
      { container: host },
    );

    try {
      await new Promise((resolve) => window.setTimeout(resolve, 75));
      expect(dispatchCommand).not.toHaveBeenCalled();
      expect(
        useQueuedTurnStore
          .getState()
          .threadsByThreadId[ACTIVE_THREAD_ID]?.items.map((item) => item.text),
      ).toEqual(["Should stay queued on the active thread"]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("pauses inactive queued turns when the thread is waiting on approval", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    window.nativeApi = {
      orchestration: {
        dispatchCommand,
      },
    } as unknown as NativeApi;

    useStore.setState({
      threads: [
        makeThread(ACTIVE_THREAD_ID),
        makeThread(BACKGROUND_THREAD_ID, {
          activities: [makeApprovalRequestedActivity()],
        }),
      ],
    });

    useQueuedTurnStore.getState().enqueueTurn(BACKGROUND_THREAD_ID, {
      id: "queued-background-approval",
      text: "Should pause for approval",
      attachments: [],
      terminalContexts: [],
      modelSelection: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-05T12:04:00.000Z",
      updatedAt: "2026-04-05T12:04:00.000Z",
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <QueuedTurnBackgroundDispatcher activeThreadId={ACTIVE_THREAD_ID} />,
      { container: host },
    );

    try {
      await vi.waitFor(() => {
        expect(
          useQueuedTurnStore.getState().threadsByThreadId[BACKGROUND_THREAD_ID]?.pauseReason,
        ).toBe("pending-approval");
      });
      expect(dispatchCommand).not.toHaveBeenCalled();
      expect(
        useQueuedTurnStore
          .getState()
          .threadsByThreadId[BACKGROUND_THREAD_ID]?.items.map((item) => item.text),
      ).toEqual(["Should pause for approval"]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("pauses inactive queued turns when the background thread is in an idle session error", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    window.nativeApi = {
      orchestration: {
        dispatchCommand,
      },
    } as unknown as NativeApi;

    useStore.setState({
      threads: [
        makeThread(ACTIVE_THREAD_ID),
        makeThread(BACKGROUND_THREAD_ID, {
          session: {
            provider: "codex" as const,
            status: "error" as const,
            orchestrationStatus: "error" as const,
            createdAt: "2026-04-05T12:05:00.000Z",
            updatedAt: "2026-04-05T12:05:00.000Z",
            lastError: "Codex CLI timed out while starting",
          },
        }),
      ],
    });

    useQueuedTurnStore.getState().enqueueTurn(BACKGROUND_THREAD_ID, {
      id: "queued-background-session-error",
      text: "Should pause for session error",
      attachments: [],
      terminalContexts: [],
      modelSelection: null,
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-04-05T12:05:30.000Z",
      updatedAt: "2026-04-05T12:05:30.000Z",
    });

    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <QueuedTurnBackgroundDispatcher activeThreadId={ACTIVE_THREAD_ID} />,
      { container: host },
    );

    try {
      await vi.waitFor(() => {
        expect(
          useQueuedTurnStore.getState().threadsByThreadId[BACKGROUND_THREAD_ID]?.pauseReason,
        ).toBe("session-error");
      });
      expect(dispatchCommand).not.toHaveBeenCalled();
      expect(
        useQueuedTurnStore
          .getState()
          .threadsByThreadId[BACKGROUND_THREAD_ID]?.items.map((item) => item.text),
      ).toEqual(["Should pause for session error"]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
