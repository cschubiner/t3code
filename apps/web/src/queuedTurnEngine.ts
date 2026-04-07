import type { Thread } from "./types";
import { hasServerAcknowledgedLocalDispatch } from "./localDispatch";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  derivePhase,
  isLatestTurnSettled,
} from "./session-logic";
import {
  deriveQueuedTurnAutoPauseReason,
  deriveQueuedTurnDispatchGate,
  getQueuedTurnDispatchState,
  IDLE_QUEUED_TURN_DISPATCH_STATE,
  type QueuedTurnDraft,
  type QueuedTurnPauseReason,
  type QueuedTurnRuntimeDispatchState,
  type ThreadQueuedTurnState,
} from "./queuedTurnStore";

export type QueuedTurnThreadAction =
  | { type: "none" }
  | { type: "pause"; reason: QueuedTurnPauseReason }
  | { type: "dispatch"; queuedTurn: QueuedTurnDraft };

export function deriveQueuedTurnThreadAction(input: {
  thread: Thread;
  queueState: ThreadQueuedTurnState | null;
  isLocalDispatchInFlight?: boolean;
}): QueuedTurnThreadAction {
  const queueState = input.queueState;
  const queuedTurn = queueState?.items[0];
  if (!queueState || !queuedTurn) {
    return { type: "none" };
  }

  if (getQueuedTurnDispatchState(queueState).status !== "idle") {
    return { type: "none" };
  }

  const hasPendingApproval = derivePendingApprovals(input.thread.activities).length > 0;
  const hasPendingUserInput = derivePendingUserInputs(input.thread.activities).length > 0;
  const hasActiveUnsettledTurn =
    input.thread.latestTurn?.startedAt != null &&
    !isLatestTurnSettled(input.thread.latestTurn, input.thread.session ?? null);

  const gate = deriveQueuedTurnDispatchGate({
    phase: derivePhase(input.thread.session),
    sessionOrchestrationStatus: input.thread.session?.orchestrationStatus ?? null,
    hasActiveUnsettledTurn,
    isLocalDispatchInFlight: Boolean(input.isLocalDispatchInFlight),
    hasPendingApproval,
    hasPendingUserInput,
  });
  const autoPauseReason = deriveQueuedTurnAutoPauseReason({
    sessionOrchestrationStatus: input.thread.session?.orchestrationStatus ?? null,
    hasActiveUnsettledTurn,
  });
  const nextPauseReason = autoPauseReason ?? gate.pauseReason;

  if (nextPauseReason !== null && queueState.pauseReason !== nextPauseReason) {
    return {
      type: "pause",
      reason: nextPauseReason,
    };
  }

  if (queueState.pauseReason !== null || !gate.canDispatch) {
    return { type: "none" };
  }

  return {
    type: "dispatch",
    queuedTurn,
  };
}

export function hasQueuedTurnDispatchBeenAcknowledged(input: {
  thread: Thread;
  dispatchState: QueuedTurnRuntimeDispatchState | null | undefined;
}): boolean {
  const dispatchState = input.dispatchState ?? IDLE_QUEUED_TURN_DISPATCH_STATE;
  const normalizedDispatchState =
    dispatchState.status === undefined ? IDLE_QUEUED_TURN_DISPATCH_STATE : dispatchState;
  if (normalizedDispatchState.status === "idle" || !normalizedDispatchState.localDispatch) {
    return false;
  }

  return hasServerAcknowledgedLocalDispatch({
    localDispatch: normalizedDispatchState.localDispatch,
    phase: derivePhase(input.thread.session),
    latestTurn: input.thread.latestTurn,
    session: input.thread.session ?? null,
    hasPendingApproval: derivePendingApprovals(input.thread.activities).length > 0,
    hasPendingUserInput: derivePendingUserInputs(input.thread.activities).length > 0,
    threadError: input.thread.error,
  });
}
