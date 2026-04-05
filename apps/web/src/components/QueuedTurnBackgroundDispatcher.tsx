import type { MessageId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import {
  createLocalDispatchSnapshot,
  hasServerAcknowledgedLocalDispatch,
  type LocalDispatchSnapshot,
} from "./ChatView.logic";
import { readNativeApi } from "../nativeApi";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  isLatestTurnSettled,
} from "../session-logic";
import { useStore } from "../store";
import type { Thread } from "../types";
import {
  deriveQueuedTurnDispatchGate,
  type QueuedTurnDraft,
  useQueuedTurnStore,
  useQueuedTurnStoreHydrated,
} from "../queuedTurnStore";
import { persistThreadSettingsForNextTurn } from "../queuedTurnDispatch";
import { newCommandId } from "~/lib/utils";

interface QueuedTurnBackgroundDispatcherProps {
  activeThreadId: ThreadId | null;
}

interface BackgroundQueuedTurnCandidate {
  thread: Thread;
  queuedTurn: QueuedTurnDraft;
}

function getPendingLocalDispatch(
  thread: Thread,
  snapshotsByThreadId: Record<string, LocalDispatchSnapshot>,
): LocalDispatchSnapshot | null {
  const snapshot = snapshotsByThreadId[thread.id];
  if (!snapshot) {
    return null;
  }

  const acknowledged = hasServerAcknowledgedLocalDispatch({
    localDispatch: snapshot,
    phase: derivePhase(thread.session),
    latestTurn: thread.latestTurn,
    session: thread.session,
    hasPendingApproval: derivePendingApprovals(thread.activities).length > 0,
    hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
    threadError: thread.error,
  });

  if (acknowledged) {
    delete snapshotsByThreadId[thread.id];
    return null;
  }

  return snapshot;
}

function selectBackgroundQueuedTurnCandidate(input: {
  activeThreadId: ThreadId | null;
  queuedThreadsByThreadId: ReturnType<typeof useQueuedTurnStore.getState>["threadsByThreadId"];
  pauseThreadQueue: ReturnType<typeof useQueuedTurnStore.getState>["pauseThreadQueue"];
  snapshotsByThreadId: Record<string, LocalDispatchSnapshot>;
  threads: readonly Thread[];
}): BackgroundQueuedTurnCandidate | null {
  let nextCandidate: BackgroundQueuedTurnCandidate | null = null;
  const pauseUpdatedAt = new Date().toISOString();

  for (const thread of input.threads) {
    if (input.activeThreadId === thread.id) {
      continue;
    }

    const queueState = input.queuedThreadsByThreadId[thread.id];
    const queuedTurn = queueState?.items[0];
    if (!queueState || !queuedTurn) {
      continue;
    }

    const pendingApprovalCount = derivePendingApprovals(thread.activities).length;
    const pendingUserInputCount = derivePendingUserInputs(thread.activities).length;
    const localDispatch = getPendingLocalDispatch(thread, input.snapshotsByThreadId);
    const hasActiveUnsettledTurn =
      thread.latestTurn?.startedAt != null &&
      !isLatestTurnSettled(thread.latestTurn, thread.session ?? null);
    const gate = deriveQueuedTurnDispatchGate({
      phase: derivePhase(thread.session),
      sessionOrchestrationStatus: thread.session?.orchestrationStatus ?? null,
      hasActiveUnsettledTurn,
      isLocalDispatchInFlight: localDispatch !== null,
      hasPendingApproval: pendingApprovalCount > 0,
      hasPendingUserInput: pendingUserInputCount > 0,
    });

    if (gate.pauseReason !== null && queueState.pauseReason !== gate.pauseReason) {
      input.pauseThreadQueue(thread.id, gate.pauseReason, pauseUpdatedAt);
      continue;
    }

    if (queueState.pauseReason !== null || !gate.canDispatch) {
      continue;
    }

    if (
      nextCandidate === null ||
      queuedTurn.createdAt.localeCompare(nextCandidate.queuedTurn.createdAt) < 0
    ) {
      nextCandidate = { thread, queuedTurn };
    }
  }

  return nextCandidate;
}

export function QueuedTurnBackgroundDispatcher({
  activeThreadId,
}: QueuedTurnBackgroundDispatcherProps) {
  const hasHydratedQueuedTurnStore = useQueuedTurnStoreHydrated();
  const queuedThreadsByThreadId = useQueuedTurnStore((store) => store.threadsByThreadId);
  const pauseThreadQueue = useQueuedTurnStore((store) => store.pauseThreadQueue);
  const removeQueuedTurn = useQueuedTurnStore((store) => store.removeQueuedTurn);
  const threads = useStore((store) => store.threads);
  const setThreadError = useStore((store) => store.setError);
  const queuedDispatchInFlightRef = useRef<ThreadId | null>(null);
  const localDispatchSnapshotsByThreadIdRef = useRef<Record<string, LocalDispatchSnapshot>>({});

  useEffect(() => {
    if (!hasHydratedQueuedTurnStore || queuedDispatchInFlightRef.current !== null) {
      return;
    }

    const nextCandidate = selectBackgroundQueuedTurnCandidate({
      activeThreadId,
      queuedThreadsByThreadId,
      pauseThreadQueue,
      snapshotsByThreadId: localDispatchSnapshotsByThreadIdRef.current,
      threads,
    });
    if (!nextCandidate) {
      return;
    }

    const { queuedTurn, thread } = nextCandidate;
    const api = readNativeApi();
    if (!api) {
      return;
    }

    queuedDispatchInFlightRef.current = thread.id;
    localDispatchSnapshotsByThreadIdRef.current[thread.id] = createLocalDispatchSnapshot(thread);
    setThreadError(thread.id, null);

    const dispatchQueuedTurn = async (): Promise<boolean> => {
      const messageIdForSend = queuedTurn.id as MessageId;
      const messageCreatedAt = new Date().toISOString();
      const modelSelectionForSend = queuedTurn.modelSelection ?? thread.modelSelection;

      try {
        await persistThreadSettingsForNextTurn(api, {
          thread,
          createdAt: messageCreatedAt,
          modelSelection: modelSelectionForSend,
          runtimeMode: queuedTurn.runtimeMode,
          interactionMode: queuedTurn.interactionMode,
        });

        await api.orchestration.dispatchCommand({
          type: "thread.turn.start",
          commandId: newCommandId(),
          threadId: thread.id,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: queuedTurn.text,
            attachments: queuedTurn.attachments.map((attachment) => ({
              type: "image" as const,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              dataUrl: attachment.dataUrl,
            })),
          },
          modelSelection: modelSelectionForSend,
          titleSeed: thread.title,
          runtimeMode: queuedTurn.runtimeMode,
          interactionMode: queuedTurn.interactionMode,
          createdAt: messageCreatedAt,
        });

        return true;
      } catch (err) {
        delete localDispatchSnapshotsByThreadIdRef.current[thread.id];
        setThreadError(
          thread.id,
          err instanceof Error ? err.message : "Failed to send queued follow-up.",
        );
        pauseThreadQueue(thread.id, "thread-error", new Date().toISOString());
        return false;
      }
    };

    void dispatchQueuedTurn()
      .then((didDispatch) => {
        if (didDispatch) {
          removeQueuedTurn(thread.id, queuedTurn.id);
        }
      })
      .finally(() => {
        if (queuedDispatchInFlightRef.current === thread.id) {
          queuedDispatchInFlightRef.current = null;
        }
      });
  }, [
    activeThreadId,
    hasHydratedQueuedTurnStore,
    pauseThreadQueue,
    queuedThreadsByThreadId,
    removeQueuedTurn,
    setThreadError,
    threads,
  ]);

  return null;
}
