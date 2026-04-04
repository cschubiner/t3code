import { ModelSelection, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "./hooks/useLocalStorage";
import {
  deriveQueuedTurnDispatchGate,
  flushQueuedTurnStoreStorage,
  type QueuedTurnDraft,
  QUEUED_TURN_STORE_STORAGE_KEY,
  QueuedTurnStoreStorageSchema,
  useQueuedTurnStore,
} from "./queuedTurnStore";

function makeQueuedTurn(input: {
  id: string;
  text: string;
  updatedAt?: string;
  modelSelection?: ModelSelection | null;
}): QueuedTurnDraft {
  return {
    id: input.id,
    text: input.text,
    attachments: [],
    terminalContexts: [],
    modelSelection: input.modelSelection ?? null,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-04-02T17:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-02T17:00:00.000Z",
  };
}

function resetQueuedTurnStore() {
  useQueuedTurnStore.setState({ threadsByThreadId: {} });
  useQueuedTurnStore.persist.clearStorage();
  removeLocalStorageItem(QUEUED_TURN_STORE_STORAGE_KEY);
}

describe("deriveQueuedTurnDispatchGate", () => {
  it("allows dispatch from a disconnected thread when nothing else is blocking", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "disconnected",
        sessionOrchestrationStatus: "stopped",
        hasActiveUnsettledTurn: false,
        isLocalDispatchInFlight: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: true,
      pauseReason: null,
      blockReason: null,
    });
  });

  it("allows dispatch from an idle errored session so the next send can recover", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "ready",
        sessionOrchestrationStatus: "error",
        hasActiveUnsettledTurn: false,
        isLocalDispatchInFlight: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: true,
      pauseReason: null,
      blockReason: null,
    });
  });

  it("blocks without pausing while the current turn is running", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "running",
        sessionOrchestrationStatus: "running",
        hasActiveUnsettledTurn: true,
        isLocalDispatchInFlight: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: false,
      pauseReason: null,
      blockReason: "running",
    });
  });

  it("keeps the queue blocked while the latest turn is still unsettled after a session error", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "ready",
        sessionOrchestrationStatus: "error",
        hasActiveUnsettledTurn: true,
        isLocalDispatchInFlight: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: false,
      pauseReason: null,
      blockReason: "running",
    });
  });

  it("pauses when an approval is pending", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "ready",
        sessionOrchestrationStatus: "ready",
        hasActiveUnsettledTurn: false,
        isLocalDispatchInFlight: false,
        hasPendingApproval: true,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: false,
      pauseReason: "pending-approval",
      blockReason: null,
    });
  });

  it("pauses when the recovered session is interrupted", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "ready",
        sessionOrchestrationStatus: "interrupted",
        hasActiveUnsettledTurn: false,
        isLocalDispatchInFlight: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: false,
      pauseReason: "session-interrupted",
      blockReason: null,
    });
  });

  it("allows dispatch when the thread is ready and idle", () => {
    expect(
      deriveQueuedTurnDispatchGate({
        phase: "ready",
        sessionOrchestrationStatus: "ready",
        hasActiveUnsettledTurn: false,
        isLocalDispatchInFlight: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
      }),
    ).toEqual({
      canDispatch: true,
      pauseReason: null,
      blockReason: null,
    });
  });
});

describe("queuedTurnStore", () => {
  const threadId = ThreadId.makeUnsafe("thread-queue");

  beforeEach(() => {
    resetQueuedTurnStore();
  });

  afterEach(() => {
    resetQueuedTurnStore();
  });

  it("enqueues, reorders, replaces, and dequeues queued turns", () => {
    const store = useQueuedTurnStore.getState();
    store.enqueueTurn(threadId, makeQueuedTurn({ id: "turn-a", text: "first" }));
    store.enqueueTurn(threadId, makeQueuedTurn({ id: "turn-b", text: "second" }));
    store.enqueueTurn(threadId, makeQueuedTurn({ id: "turn-c", text: "third" }));

    store.moveQueuedTurn(threadId, "turn-c", 1);
    store.replaceQueuedTurn(
      threadId,
      "turn-b",
      makeQueuedTurn({
        id: "turn-b",
        text: "second-updated",
        updatedAt: "2026-04-02T17:00:05.000Z",
      }),
    );

    expect(
      useQueuedTurnStore
        .getState()
        .getQueuedTurns(threadId)
        .map((turn) => turn.id),
    ).toEqual(["turn-a", "turn-c", "turn-b"]);
    expect(useQueuedTurnStore.getState().getQueuedTurns(threadId)[2]?.text).toBe("second-updated");

    const dequeued = useQueuedTurnStore.getState().dequeueNextTurn(threadId);
    expect(dequeued?.id).toBe("turn-a");
    expect(
      useQueuedTurnStore
        .getState()
        .getQueuedTurns(threadId)
        .map((turn) => turn.id),
    ).toEqual(["turn-c", "turn-b"]);
  });

  it("pauses and resumes a thread queue without dropping entries", () => {
    const store = useQueuedTurnStore.getState();
    store.enqueueTurn(threadId, makeQueuedTurn({ id: "turn-a", text: "first" }));
    store.pauseThreadQueue(threadId, "pending-user-input", "2026-04-02T17:01:00.000Z");

    expect(useQueuedTurnStore.getState().getThreadQueue(threadId)).toMatchObject({
      pauseReason: "pending-user-input",
      updatedAt: "2026-04-02T17:01:00.000Z",
    });

    store.resumeThreadQueue(threadId, "2026-04-02T17:01:05.000Z");

    expect(useQueuedTurnStore.getState().getThreadQueue(threadId)).toMatchObject({
      pauseReason: null,
      updatedAt: "2026-04-02T17:01:05.000Z",
    });
    expect(useQueuedTurnStore.getState().getQueuedTurns(threadId)).toHaveLength(1);
  });

  it("removes empty thread queue state after the last item is cleared", () => {
    const store = useQueuedTurnStore.getState();
    store.enqueueTurn(threadId, makeQueuedTurn({ id: "turn-a", text: "first" }));
    store.removeQueuedTurn(threadId, "turn-a");

    expect(useQueuedTurnStore.getState().getThreadQueue(threadId)).toBeNull();
  });

  it("persists queued turns and pause state to local storage", async () => {
    const store = useQueuedTurnStore.getState();
    store.enqueueTurn(threadId, makeQueuedTurn({ id: "turn-a", text: "first" }));
    store.pauseThreadQueue(threadId, "session-error", "2026-04-02T17:02:00.000Z");
    flushQueuedTurnStoreStorage();

    const persisted = getLocalStorageItem(
      QUEUED_TURN_STORE_STORAGE_KEY,
      QueuedTurnStoreStorageSchema,
    );

    expect(persisted?.state.threadsByThreadId[threadId]).toMatchObject({
      pauseReason: "session-error",
      updatedAt: "2026-04-02T17:02:00.000Z",
    });
    expect(persisted?.state.threadsByThreadId[threadId]?.items.map((turn) => turn.id)).toEqual([
      "turn-a",
    ]);
  });

  it("rehydrates queued turns from persisted storage", async () => {
    setLocalStorageItem(
      QUEUED_TURN_STORE_STORAGE_KEY,
      {
        version: 1,
        state: {
          threadsByThreadId: {
            [threadId]: {
              items: [makeQueuedTurn({ id: "turn-a", text: "first" })],
              pauseReason: "thread-error",
              updatedAt: "2026-04-02T17:03:00.000Z",
            },
          },
        },
      },
      QueuedTurnStoreStorageSchema,
    );

    useQueuedTurnStore.setState({ threadsByThreadId: {} });
    await useQueuedTurnStore.persist.rehydrate();

    expect(useQueuedTurnStore.getState().getThreadQueue(threadId)).toMatchObject({
      pauseReason: "thread-error",
      updatedAt: "2026-04-02T17:03:00.000Z",
    });
    expect(useQueuedTurnStore.getState().getQueuedTurns(threadId)[0]?.text).toBe("first");
  });
});
