import type { ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";

import { createLocalDispatchSnapshot } from "../localDispatch";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import type { Thread } from "../types";
import { dispatchQueuedTurnCommand } from "../queuedTurnDispatch";
import {
  deriveQueuedTurnThreadAction,
  hasQueuedTurnDispatchBeenAcknowledged,
} from "../queuedTurnEngine";
import {
  getQueuedTurnDispatchState,
  useQueuedTurnStore,
  useQueuedTurnStoreHydrated,
} from "../queuedTurnStore";

interface QueuedTurnBackgroundDispatcherProps {
  activeThreadId: ThreadId | null;
}

function selectNextInactiveDispatchCandidate(input: {
  activeThreadId: ThreadId | null;
  threads: readonly Thread[];
  queuedThreadsByThreadId: ReturnType<typeof useQueuedTurnStore.getState>["threadsByThreadId"];
}): { thread: Thread; queuedTurnId: string } | null {
  let nextCandidate: { thread: Thread; queuedTurnId: string; createdAt: string } | null = null;

  for (const thread of input.threads) {
    if (thread.id === input.activeThreadId) {
      continue;
    }

    const queueState = input.queuedThreadsByThreadId[thread.id] ?? null;
    const action = deriveQueuedTurnThreadAction({
      thread,
      queueState,
      isLocalDispatchInFlight: false,
    });

    if (action.type !== "dispatch") {
      continue;
    }

    if (nextCandidate === null || action.queuedTurn.createdAt < nextCandidate.createdAt) {
      nextCandidate = {
        thread,
        queuedTurnId: action.queuedTurn.id,
        createdAt: action.queuedTurn.createdAt,
      };
    }
  }

  return nextCandidate
    ? {
        thread: nextCandidate.thread,
        queuedTurnId: nextCandidate.queuedTurnId,
      }
    : null;
}

export function QueuedTurnBackgroundDispatcher({
  activeThreadId,
}: QueuedTurnBackgroundDispatcherProps) {
  const hasHydratedQueuedTurnStore = useQueuedTurnStoreHydrated();
  const queuedThreadsByThreadId = useQueuedTurnStore((store) => store.threadsByThreadId);
  const beginDispatch = useQueuedTurnStore((store) => store.beginDispatch);
  const markDispatchAwaitingAck = useQueuedTurnStore((store) => store.markDispatchAwaitingAck);
  const acknowledgeDispatch = useQueuedTurnStore((store) => store.acknowledgeDispatch);
  const resetDispatch = useQueuedTurnStore((store) => store.resetDispatch);
  const pauseThreadQueue = useQueuedTurnStore((store) => store.pauseThreadQueue);
  const threads = useStore((store) => store.threads);
  const setThreadError = useStore((store) => store.setError);

  useEffect(() => {
    if (!hasHydratedQueuedTurnStore) {
      return;
    }

    const acknowledgedThreadIds = threads.flatMap((thread) => {
      if (thread.id === activeThreadId) {
        return [];
      }

      const queueState = queuedThreadsByThreadId[thread.id] ?? null;
      if (
        getQueuedTurnDispatchState(queueState).status === "idle" ||
        !hasQueuedTurnDispatchBeenAcknowledged({
          thread,
          dispatchState: getQueuedTurnDispatchState(queueState),
        })
      ) {
        return [];
      }

      const queuedTurnId = getQueuedTurnDispatchState(queueState).queuedTurnId;
      return queuedTurnId ? [{ threadId: thread.id, queuedTurnId }] : [];
    });

    if (acknowledgedThreadIds.length === 0) {
      return;
    }

    const updatedAt = new Date().toISOString();
    for (const acknowledgedDispatch of acknowledgedThreadIds) {
      acknowledgeDispatch(
        acknowledgedDispatch.threadId,
        acknowledgedDispatch.queuedTurnId,
        updatedAt,
      );
    }
  }, [
    acknowledgeDispatch,
    activeThreadId,
    hasHydratedQueuedTurnStore,
    queuedThreadsByThreadId,
    threads,
  ]);

  useEffect(() => {
    if (!hasHydratedQueuedTurnStore) {
      return;
    }

    const updatedAt = new Date().toISOString();
    for (const thread of threads) {
      if (thread.id === activeThreadId) {
        continue;
      }

      const queueState = queuedThreadsByThreadId[thread.id] ?? null;
      const action = deriveQueuedTurnThreadAction({
        thread,
        queueState,
        isLocalDispatchInFlight: false,
      });

      if (action.type === "pause") {
        pauseThreadQueue(thread.id, action.reason, updatedAt);
      }
    }
  }, [
    activeThreadId,
    hasHydratedQueuedTurnStore,
    pauseThreadQueue,
    queuedThreadsByThreadId,
    threads,
  ]);

  useEffect(() => {
    if (!hasHydratedQueuedTurnStore) {
      return;
    }

    const nextCandidate = selectNextInactiveDispatchCandidate({
      activeThreadId,
      queuedThreadsByThreadId,
      threads,
    });
    if (!nextCandidate) {
      return;
    }

    const queueState = queuedThreadsByThreadId[nextCandidate.thread.id];
    const queuedTurn = queueState?.items.find((item) => item.id === nextCandidate.queuedTurnId);
    if (!queueState || !queuedTurn) {
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    const localDispatchSnapshot = createLocalDispatchSnapshot(nextCandidate.thread);
    const createdAt = new Date().toISOString();

    beginDispatch(nextCandidate.thread.id, queuedTurn.id, localDispatchSnapshot);
    setThreadError(nextCandidate.thread.id, null);

    void dispatchQueuedTurnCommand(api, {
      thread: nextCandidate.thread,
      queuedTurn,
      createdAt,
    })
      .then(() => {
        markDispatchAwaitingAck(nextCandidate.thread.id, queuedTurn.id, localDispatchSnapshot);
      })
      .catch((err) => {
        resetDispatch(nextCandidate.thread.id);
        setThreadError(
          nextCandidate.thread.id,
          err instanceof Error ? err.message : "Failed to send queued follow-up.",
        );
        pauseThreadQueue(nextCandidate.thread.id, "thread-error", new Date().toISOString());
      });
  }, [
    activeThreadId,
    beginDispatch,
    hasHydratedQueuedTurnStore,
    markDispatchAwaitingAck,
    pauseThreadQueue,
    queuedThreadsByThreadId,
    resetDispatch,
    setThreadError,
    threads,
  ]);

  return null;
}
