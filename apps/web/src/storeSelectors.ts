import { type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  findLatestProposedPlan,
  hasActionableProposedPlan,
} from "./session-logic";
import { selectProjectById, selectThreadById, useStore } from "./store";
import { type Project, type SidebarThreadSummary, type Thread } from "./types";

function getLatestUserMessageAt(
  messages: ReadonlyArray<Thread["messages"][number]>,
): string | null {
  let latestUserMessageAt: string | null = null;

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    if (latestUserMessageAt === null || message.createdAt > latestUserMessageAt) {
      latestUserMessageAt = message.createdAt;
    }
  }

  return latestUserMessageAt;
}

export function useProjectById(projectId: Project["id"] | null | undefined): Project | undefined {
  const selector = useMemo(() => selectProjectById(projectId), [projectId]);
  return useStore(selector);
}

export function useThreadById(threadId: ThreadId | null | undefined): Thread | undefined {
  const selector = useMemo(() => selectThreadById(threadId), [threadId]);
  return useStore(selector);
}

export function useSidebarThreadSummaryById(
  threadId: ThreadId | null | undefined,
): SidebarThreadSummary | undefined {
  const selector = useMemo(
    () =>
      (state: { threads: Thread[] }): SidebarThreadSummary | undefined => {
        if (!threadId) {
          return undefined;
        }
        const thread = state.threads.find((candidate) => candidate.id === threadId);
        if (!thread) {
          return undefined;
        }
        return {
          id: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          interactionMode: thread.interactionMode,
          session: thread.session,
          createdAt: thread.createdAt,
          archivedAt: thread.archivedAt,
          updatedAt: thread.updatedAt,
          latestTurn: thread.latestTurn,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          latestUserMessageAt: getLatestUserMessageAt(thread.messages),
          hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
          hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
          hasActionableProposedPlan: hasActionableProposedPlan(
            findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
          ),
        };
      },
    [threadId],
  );
  return useStore(selector);
}
