import * as React from "react";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import type { Project, Thread } from "../types";
import type { ThreadId } from "@t3tools/contracts";
import { cn } from "../lib/utils";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 100;
export type SidebarNewThreadEnvMode = "local" | "worktree";
export type SidebarThreadListMode = "grouped" | "recent";

type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};
type SidebarThreadSortInput = Pick<Thread, "createdAt" | "updatedAt"> & {
  latestUserMessageAt?: string | null;
  messages?: Pick<Thread["messages"][number], "createdAt" | "role">[];
};

export type ThreadTraversalDirection = "previous" | "next";

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

export interface SidebarPullRequestReference {
  url: string;
  owner: string;
  repo: string;
  number: string;
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
type ThreadPullRequestReferenceInput = Pick<Thread, "messages" | "queuedTurns" | "worktreePath">;

const GITHUB_PULL_REQUEST_URL_GLOBAL_PATTERN =
  /https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<repo>[^/\s]+)\/pull\/(?<number>\d+)(?:[/?#][^\s)\]}>]*)?/gi;

function sidebarPullRequestReferenceKey(
  input: Pick<SidebarPullRequestReference, "owner" | "repo" | "number">,
): string {
  return `${input.owner.toLowerCase()}/${input.repo.toLowerCase()}#${input.number}`;
}

export type SidebarNavigationDirection = "previous" | "next";
export interface SidebarProjectNavigationTarget {
  projectId: Project["id"];
  threadId: ThreadId;
}
export function visibleThreadsForSidebar(input: {
  projectThreads: readonly Thread[];
  activeThreadId?: Thread["id"] | undefined;
  isThreadListExpanded: boolean;
  threadPreviewLimit: number;
}): Thread[] {
  return getVisibleThreadsForProject({
    threads: input.projectThreads,
    activeThreadId: input.activeThreadId,
    isThreadListExpanded: input.isThreadListExpanded,
    previewLimit: input.threadPreviewLimit,
  }).visibleThreads;
}

export function visibleRecentThreadsForSidebar(input: {
  threads: readonly Thread[];
  isExpanded: boolean;
  threadPreviewLimit: number;
}): Thread[] {
  const orderedThreads = sortThreadsForRecentSidebar(input.threads);
  if (orderedThreads.length <= input.threadPreviewLimit || input.isExpanded) {
    return orderedThreads;
  }
  return orderedThreads.slice(0, input.threadPreviewLimit);
}

export function visibleThreadIdsForSidebar(input: {
  projects: readonly Project[];
  threads: readonly Thread[];
  expandedThreadListsByProject: ReadonlySet<Project["id"]>;
  threadPreviewLimit: number;
  threadSortOrder: SidebarThreadSortOrder;
  activeThreadId?: Thread["id"] | undefined;
}): ThreadId[] {
  const visibleThreadIds: ThreadId[] = [];

  for (const project of input.projects) {
    if (!project.expanded) continue;
    const projectThreads = sortThreadsForSidebar(
      input.threads.filter((thread) => thread.projectId === project.id),
      input.threadSortOrder,
    );
    const visibleThreads = visibleThreadsForSidebar({
      projectThreads,
      activeThreadId: input.activeThreadId,
      isThreadListExpanded: input.expandedThreadListsByProject.has(project.id),
      threadPreviewLimit: input.threadPreviewLimit,
    });
    for (const thread of visibleThreads) {
      visibleThreadIds.push(thread.id);
    }
  }

  return visibleThreadIds;
}

export function visibleThreadIdsForRecentSidebar(input: {
  threads: readonly Thread[];
  isExpanded: boolean;
  threadPreviewLimit: number;
}): ThreadId[] {
  return visibleRecentThreadsForSidebar(input).map((thread) => thread.id);
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
  threadSortOrder: SidebarThreadSortOrder;
}): SidebarProjectNavigationTarget[] {
  const targets: SidebarProjectNavigationTarget[] = [];

  for (const project of input.projects) {
    const newestThread = sortThreadsForSidebar(
      input.threads.filter((thread) => thread.projectId === project.id),
      input.threadSortOrder,
    )[0];
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

export function deriveSidebarThreadProjectName(input: {
  thread: Pick<Thread, "projectId">;
  projects: readonly Pick<Project, "id" | "name">[];
}): string {
  return input.projects.find((project) => project.id === input.thread.projectId)?.name ?? "Unknown";
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

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
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

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const { getId, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const itemsById = new Map(items.map((item) => [getId(item), item] as const));
  const preferredIdSet = new Set(preferredIds);
  const emittedPreferredIds = new Set<TId>();
  const ordered = preferredIds.flatMap((id) => {
    if (emittedPreferredIds.has(id)) {
      return [];
    }
    const item = itemsById.get(id);
    if (!item) {
      return [];
    }
    emittedPreferredIds.add(id);
    return [item];
  });
  const remaining = items.filter((item) => !preferredIdSet.has(getId(item)));
  return [...ordered, ...remaining];
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreads: readonly {
      id: TThreadId;
    }[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false
      ? []
      : renderedProject.renderedThreads.map((thread) => thread.id),
  );
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
  hasSecondaryContent?: boolean;
}): string {
  const baseClassName = cn(
    "w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
    input.hasSecondaryContent ? "min-h-9 py-1" : "h-7",
  );

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

export function extractSidebarPullRequestReferences(text: string): SidebarPullRequestReference[] {
  const matches = text.matchAll(GITHUB_PULL_REQUEST_URL_GLOBAL_PATTERN);
  const references: SidebarPullRequestReference[] = [];
  const seenReferences = new Set<string>();

  for (const match of matches) {
    const url = match[0];
    const owner = match.groups?.owner;
    const repo = match.groups?.repo;
    const number = match.groups?.number;
    if (!url || !owner || !repo || !number) {
      continue;
    }
    const reference = { url, owner, repo, number };
    const referenceKey = sidebarPullRequestReferenceKey(reference);
    if (seenReferences.has(referenceKey)) {
      continue;
    }
    seenReferences.add(referenceKey);
    references.push(reference);
  }

  return references;
}

export function deriveThreadSidebarPullRequestReferences(
  thread: ThreadPullRequestReferenceInput,
): SidebarPullRequestReference[] {
  if (thread.worktreePath === null) {
    return [];
  }

  const references: SidebarPullRequestReference[] = [];
  const seenReferences = new Set<string>();
  const texts = [
    ...thread.messages.map((message) => message.text),
    ...thread.queuedTurns.map((queuedTurn) => queuedTurn.text),
  ];

  for (const text of texts) {
    for (const reference of extractSidebarPullRequestReferences(text)) {
      const referenceKey = sidebarPullRequestReferenceKey(reference);
      if (seenReferences.has(referenceKey)) {
        continue;
      }
      seenReferences.add(referenceKey);
      references.push(reference);
    }
  }

  return references;
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

  const hasStaleRunningLatestTurn =
    thread.latestTurn?.state === "running" &&
    thread.session?.status !== "error" &&
    thread.session?.status !== "closed" &&
    thread.session?.orchestrationStatus !== "stopped";

  const hasActiveRunningTurn =
    thread.session?.status === "running" ||
    thread.session?.orchestrationStatus === "running" ||
    hasStaleRunningLatestTurn;

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

export function getVisibleThreadsForProject<T extends Pick<Thread, "id">>(input: {
  threads: readonly T[];
  activeThreadId: T["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: T[];
  hiddenThreads: T[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      hiddenThreads: [],
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    hiddenThreads: threads.filter((thread) => !visibleThreadIds.has(thread.id)),
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getLatestUserMessageTimestamp(thread: SidebarThreadSortInput): number {
  if (thread.latestUserMessageAt) {
    return toSortableTimestamp(thread.latestUserMessageAt) ?? Number.NEGATIVE_INFINITY;
  }

  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages ?? []) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function getThreadSortTimestamp(
  thread: SidebarThreadSortInput,
  sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

function threadRecentSortTimestamp(thread: Pick<Thread, "createdAt" | "updatedAt">): number {
  return Date.parse(thread.updatedAt ?? thread.createdAt);
}

export function sortThreadsForSidebar<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt"> & SidebarThreadSortInput,
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  return threads.toSorted((left, right) => {
    const rightTimestamp = getThreadSortTimestamp(right, sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & SidebarThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreadsForSidebar(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}

export function sortThreadsForRecentSidebar<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt">,
>(threads: readonly T[]): T[] {
  return threads.toSorted((left, right) => {
    const byUpdatedAt = threadRecentSortTimestamp(right) - threadRecentSortTimestamp(left);
    if (byUpdatedAt !== 0) return byUpdatedAt;

    const byCreatedAt = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;

    return right.id.localeCompare(left.id);
  });
}

export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly SidebarThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & SidebarThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
