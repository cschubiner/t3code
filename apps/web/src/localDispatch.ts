import { OrchestrationSessionStatus, TurnId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { SessionPhase, Thread, ThreadSession } from "./types";

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionActiveTurnId: TurnId | null;
  sessionOrchestrationStatus: ThreadSession["orchestrationStatus"] | null;
}

export const LocalDispatchSnapshotSchema = Schema.Struct({
  startedAt: Schema.String,
  preparingWorktree: Schema.Boolean,
  latestTurnTurnId: Schema.NullOr(TurnId),
  latestTurnRequestedAt: Schema.NullOr(Schema.String),
  latestTurnStartedAt: Schema.NullOr(Schema.String),
  latestTurnCompletedAt: Schema.NullOr(Schema.String),
  sessionActiveTurnId: Schema.NullOr(TurnId),
  sessionOrchestrationStatus: Schema.NullOr(OrchestrationSessionStatus),
});

export function createLocalDispatchSnapshot(
  thread: Thread | undefined,
  options?: { preparingWorktree?: boolean },
): LocalDispatchSnapshot {
  const latestTurn = thread?.latestTurn ?? null;
  const session = thread?.session ?? null;

  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionActiveTurnId: session?.activeTurnId ?? null,
    sessionOrchestrationStatus: session?.orchestrationStatus ?? null,
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }

  if (
    input.phase === "running" ||
    input.hasPendingApproval ||
    input.hasPendingUserInput ||
    Boolean(input.threadError)
  ) {
    return true;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const nextSessionOrchestrationStatus = session?.orchestrationStatus ?? null;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (latestTurnChanged) {
    return true;
  }

  if (input.localDispatch.sessionActiveTurnId !== (session?.activeTurnId ?? null)) {
    return true;
  }

  return (
    input.localDispatch.sessionOrchestrationStatus !== nextSessionOrchestrationStatus &&
    nextSessionOrchestrationStatus !== null &&
    (nextSessionOrchestrationStatus === "running" ||
      nextSessionOrchestrationStatus === "error" ||
      nextSessionOrchestrationStatus === "interrupted")
  );
}
