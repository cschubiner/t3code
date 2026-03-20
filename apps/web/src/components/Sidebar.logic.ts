import type { Project, Thread } from "../types";
import type { ThreadId } from "@t3tools/contracts";
import { cn } from "../lib/utils";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarNewThreadEnvMode = "local" | "worktree";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export type SidebarNavigationDirection = "previous" | "next";
export interface SidebarProjectNavigationTarget {
  projectId: Project["id"];
  threadId: ThreadId;
}

export function sortThreadsForSidebar(
  projectId: Project["id"],
  threads: readonly Thread[],
): Thread[] {
  return threads
    .filter((thread) => thread.projectId === projectId)
    .toSorted((a, b) => {
      const byDate = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (byDate !== 0) return byDate;
      return b.id.localeCompare(a.id);
    });
}

export function visibleThreadsForSidebar(input: {
  projectThreads: readonly Thread[];
  isThreadListExpanded: boolean;
  threadPreviewLimit: number;
}): Thread[] {
  const { projectThreads, isThreadListExpanded, threadPreviewLimit } = input;
  if (projectThreads.length <= threadPreviewLimit || isThreadListExpanded) {
    return [...projectThreads];
  }
  return projectThreads.slice(0, threadPreviewLimit);
}

export function visibleThreadIdsForSidebar(input: {
  projects: readonly Project[];
  threads: readonly Thread[];
  expandedThreadListsByProject: ReadonlySet<Project["id"]>;
  threadPreviewLimit: number;
}): ThreadId[] {
  const visibleThreadIds: ThreadId[] = [];

  for (const project of input.projects) {
    if (!project.expanded) continue;
    const projectThreads = sortThreadsForSidebar(project.id, input.threads);
    const visibleThreads = visibleThreadsForSidebar({
      projectThreads,
      isThreadListExpanded: input.expandedThreadListsByProject.has(project.id),
      threadPreviewLimit: input.threadPreviewLimit,
    });
    for (const thread of visibleThreads) {
      visibleThreadIds.push(thread.id);
    }
  }

  return visibleThreadIds;
}

export function resolveSidebarThreadNavigationTarget(input: {
  orderedVisibleThreadIds: readonly ThreadId[];
  currentThreadId: ThreadId | null;
  direction: SidebarNavigationDirection;
}): ThreadId | null {
  const { orderedVisibleThreadIds, currentThreadId, direction } = input;
  if (orderedVisibleThreadIds.length === 0) return null;

  if (currentThreadId === null) {
    return direction === "next"
      ? (orderedVisibleThreadIds[0] ?? null)
      : (orderedVisibleThreadIds.at(-1) ?? null);
  }

  const currentIndex = orderedVisibleThreadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return direction === "next"
      ? (orderedVisibleThreadIds[0] ?? null)
      : (orderedVisibleThreadIds.at(-1) ?? null);
  }

  if (direction === "previous") {
    return orderedVisibleThreadIds[currentIndex - 1] ?? null;
  }

  return orderedVisibleThreadIds[currentIndex + 1] ?? null;
}

export function projectNavigationTargetsForSidebar(input: {
  projects: readonly Project[];
  threads: readonly Thread[];
}): SidebarProjectNavigationTarget[] {
  const targets: SidebarProjectNavigationTarget[] = [];

  for (const project of input.projects) {
    const newestThread = sortThreadsForSidebar(project.id, input.threads)[0];
    if (!newestThread) continue;
    targets.push({
      projectId: project.id,
      threadId: newestThread.id,
    });
  }

  return targets;
}

export function resolveSidebarProjectNavigationTarget(input: {
  orderedProjectTargets: readonly SidebarProjectNavigationTarget[];
  currentProjectId: Project["id"] | null;
  direction: SidebarNavigationDirection;
}): SidebarProjectNavigationTarget | null {
  const { orderedProjectTargets, currentProjectId, direction } = input;
  if (orderedProjectTargets.length === 0) return null;

  if (currentProjectId === null) {
    return direction === "next"
      ? (orderedProjectTargets[0] ?? null)
      : (orderedProjectTargets.at(-1) ?? null);
  }

  const currentIndex = orderedProjectTargets.findIndex(
    (target) => target.projectId === currentProjectId,
  );
  if (currentIndex === -1) {
    return direction === "next"
      ? (orderedProjectTargets[0] ?? null)
      : (orderedProjectTargets.at(-1) ?? null);
  }

  if (direction === "previous") {
    return orderedProjectTargets[currentIndex - 1] ?? null;
  }

  return orderedProjectTargets[currentIndex + 1] ?? null;
}

export function isTypingInSidebarTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const editableTarget =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
      ? target
      : target.closest<HTMLElement>("input, textarea, select, [contenteditable]");

  if (!editableTarget) return false;

  return (
    editableTarget.closest("[data-sidebar='sidebar']") !== null ||
    editableTarget.closest("[data-slot='sidebar']") !== null
  );
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  hasTransientWork?: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, hasTransientWork = false, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  const hasActiveRunningTurn =
    thread.session?.status === "running" ||
    thread.session?.orchestrationStatus === "running" ||
    thread.latestTurn?.state === "running";

  if (hasTransientWork || hasActiveRunningTurn) {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}
