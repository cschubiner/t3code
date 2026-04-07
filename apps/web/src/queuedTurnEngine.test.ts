import { ModelSelection, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { createLocalDispatchSnapshot } from "./localDispatch";
import {
  deriveQueuedTurnThreadAction,
  hasQueuedTurnDispatchBeenAcknowledged,
} from "./queuedTurnEngine";
import {
  IDLE_QUEUED_TURN_DISPATCH_STATE,
  type QueuedTurnDraft,
  type ThreadQueuedTurnState,
} from "./queuedTurnStore";
import type { Thread } from "./types";

const MODEL_SELECTION: ModelSelection = {
  provider: "codex",
  model: "gpt-5",
};

function makeQueuedTurn(
  id: string,
  text: string,
  createdAt = "2026-04-06T23:00:00.000Z",
): QueuedTurnDraft {
  return {
    id,
    text,
    attachments: [],
    terminalContexts: [],
    modelSelection: null,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt,
    updatedAt: createdAt,
  };
}

function makeThread(overrides?: Partial<Thread>): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: "codex-thread-1",
    projectId: "project-1" as Thread["projectId"],
    title: "Test thread",
    modelSelection: MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: "default",
    session: {
      provider: "codex",
      status: "ready",
      activeTurnId: undefined,
      createdAt: "2026-04-06T23:00:00.000Z",
      updatedAt: "2026-04-06T23:00:00.000Z",
      orchestrationStatus: "ready",
    },
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-06T23:00:00.000Z",
    archivedAt: null,
    latestTurn: null,
    branch: "main",
    worktreePath: "/repo",
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeQueueState(input?: Partial<ThreadQueuedTurnState>): ThreadQueuedTurnState {
  return {
    items: input?.items ?? [makeQueuedTurn("queued-1", "Queued follow-up")],
    pauseReason: input?.pauseReason ?? null,
    updatedAt: input?.updatedAt ?? "2026-04-06T23:00:00.000Z",
    dispatch: input?.dispatch ?? IDLE_QUEUED_TURN_DISPATCH_STATE,
  };
}

describe("deriveQueuedTurnThreadAction", () => {
  it("dispatches the head queued turn when the thread is idle", () => {
    const action = deriveQueuedTurnThreadAction({
      thread: makeThread(),
      queueState: makeQueueState(),
      isLocalDispatchInFlight: false,
    });

    expect(action).toMatchObject({
      type: "dispatch",
      queuedTurn: expect.objectContaining({ id: "queued-1" }),
    });
  });

  it("does not dispatch while a queued turn is already awaiting acknowledgement", () => {
    const action = deriveQueuedTurnThreadAction({
      thread: makeThread(),
      queueState: makeQueueState({
        dispatch: {
          status: "awaiting-ack",
          queuedTurnId: "queued-1",
          localDispatch: createLocalDispatchSnapshot(makeThread()),
        },
      }),
      isLocalDispatchInFlight: false,
    });

    expect(action).toEqual({ type: "none" });
  });

  it("pauses an idle errored session instead of dispatching", () => {
    const action = deriveQueuedTurnThreadAction({
      thread: makeThread({
        session: {
          provider: "codex",
          status: "error",
          activeTurnId: undefined,
          createdAt: "2026-04-06T23:00:00.000Z",
          updatedAt: "2026-04-06T23:00:00.000Z",
          orchestrationStatus: "error",
          lastError: "provider failed",
        },
      }),
      queueState: makeQueueState(),
      isLocalDispatchInFlight: false,
    });

    expect(action).toEqual({
      type: "pause",
      reason: "session-error",
    });
  });
});

describe("hasQueuedTurnDispatchBeenAcknowledged", () => {
  it("does not treat draft thread materialization alone as an acknowledgement", () => {
    const dispatchState = {
      status: "awaiting-ack" as const,
      queuedTurnId: "queued-1",
      localDispatch: createLocalDispatchSnapshot(
        makeThread({
          session: null,
        }),
      ),
    };

    expect(
      hasQueuedTurnDispatchBeenAcknowledged({
        thread: makeThread({
          session: {
            provider: "codex",
            status: "ready",
            activeTurnId: undefined,
            createdAt: "2026-04-06T23:00:01.000Z",
            updatedAt: "2026-04-06T23:00:01.000Z",
            orchestrationStatus: "ready",
          },
        }),
        dispatchState,
      }),
    ).toBe(false);
  });

  it("does not treat a newly created stopped session as an acknowledgement", () => {
    const dispatchState = {
      status: "awaiting-ack" as const,
      queuedTurnId: "queued-1",
      localDispatch: createLocalDispatchSnapshot(
        makeThread({
          session: null,
        }),
      ),
    };

    expect(
      hasQueuedTurnDispatchBeenAcknowledged({
        thread: makeThread({
          session: {
            provider: "codex",
            status: "ready",
            activeTurnId: undefined,
            createdAt: "2026-04-06T23:00:01.000Z",
            updatedAt: "2026-04-06T23:00:01.000Z",
            orchestrationStatus: "stopped",
          },
        }),
        dispatchState,
      }),
    ).toBe(false);
  });

  it("acknowledges once the server attaches an active turn", () => {
    const turnId = TurnId.makeUnsafe("turn-1");
    const dispatchState = {
      status: "awaiting-ack" as const,
      queuedTurnId: "queued-1",
      localDispatch: createLocalDispatchSnapshot(makeThread()),
    };

    expect(
      hasQueuedTurnDispatchBeenAcknowledged({
        thread: makeThread({
          session: {
            provider: "codex",
            status: "running",
            activeTurnId: turnId,
            createdAt: "2026-04-06T23:00:00.000Z",
            updatedAt: "2026-04-06T23:00:02.000Z",
            orchestrationStatus: "running",
          },
        }),
        dispatchState,
      }),
    ).toBe(true);
  });
});
