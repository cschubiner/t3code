import React, { useCallback, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";

import { useUiStateStore } from "../uiStateStore";
import {
  selectProjectByRef,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
  type AppState,
} from "../store";
import type { Project, SidebarThreadSummary } from "../types";
import { sortThreads } from "../lib/threadSort";
import { useThreadActions } from "../hooks/useThreadActions";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { newCommandId } from "../lib/utils";
import { readEnvironmentApi } from "../environmentApi";
import { readLocalApi } from "../localApi";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import {
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  type ThreadStatusPill,
} from "./Sidebar.logic";
import { SidebarContent, SidebarGroup, SidebarMenu } from "./ui/sidebar";
import { toastManager } from "./ui/toast";
import { formatRelativeTimeLabel } from "../timestampFormat";

const RECENT_THREAD_LIMIT = 200;

type DateBucketId = "today" | "yesterday" | "week" | "earlier";

type DateBucket = {
  id: DateBucketId;
  label: string;
  threads: SidebarThreadSummary[];
};

const BUCKET_LABELS: Record<DateBucketId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Earlier this week",
  earlier: "Older",
};

function bucketForTimestamp(timestamp: number, now: number): DateBucketId {
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = now - timestamp;
  if (diff < dayMs) return "today";
  if (diff < 2 * dayMs) return "yesterday";
  if (diff < 7 * dayMs) return "week";
  return "earlier";
}

function StatusDot({ status }: { status: ThreadStatusPill }) {
  return (
    <span
      title={status.label}
      className={`inline-flex size-3.5 shrink-0 items-center justify-center ${status.colorClass}`}
    >
      <span
        className={`size-[9px] rounded-full ${status.dotClass} ${
          status.pulse ? "animate-pulse" : ""
        }`}
      />
      <span className="sr-only">{status.label}</span>
    </span>
  );
}

export function SidebarRecentContent() {
  const navigate = useNavigate();
  const { archiveThread, deleteThread } = useThreadActions();
  const sidebarThreadSortOrder = useSettings((s) => s.sidebarThreadSortOrder);
  const appSettingsConfirmThreadDelete = useSettings((s) => s.confirmThreadDelete);
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);

  const allThreads = useStore(
    useShallow((state: AppState) => selectSidebarThreadsAcrossEnvironments(state)),
  );

  const visibleThreads = useMemo(() => {
    const visible = allThreads.filter((t) => t.archivedAt == null);
    return sortThreads(visible, sidebarThreadSortOrder).slice(0, RECENT_THREAD_LIMIT);
  }, [allThreads, sidebarThreadSortOrder]);

  const buckets = useMemo<DateBucket[]>(() => {
    const now = Date.now();
    const grouped: Record<DateBucketId, SidebarThreadSummary[]> = {
      today: [],
      yesterday: [],
      week: [],
      earlier: [],
    };
    for (const thread of visibleThreads) {
      const tsValue = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt ?? null;
      const ts = tsValue ? Date.parse(tsValue) : Number.NaN;
      const bucketId = Number.isFinite(ts) ? bucketForTimestamp(ts, now) : "earlier";
      grouped[bucketId].push(thread);
    }
    return (["today", "yesterday", "week", "earlier"] as const)
      .filter((id) => grouped[id].length > 0)
      .map((id) => ({ id, label: BUCKET_LABELS[id], threads: grouped[id] }));
  }, [visibleThreads]);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;

  // Inline rename state
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState<string>("");
  const renamingCommittedRef = useRef(false);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate],
  );

  const { copyToClipboard: copyPath } = useCopyToClipboard<{ path: string }>({
    onCopy: (ctx) => {
      toastManager.add({ type: "success", title: "Path copied", description: ctx.path });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });

  const { copyToClipboard: copyThreadId } = useCopyToClipboard<{ threadId: string }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });

  const beginRename = useCallback((threadKey: string, currentTitle: string) => {
    setRenamingThreadKey(threadKey);
    setRenamingTitle(currentTitle);
    renamingCommittedRef.current = false;
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        setRenamingThreadKey(null);
        return;
      }
      if (trimmed === originalTitle) {
        setRenamingThreadKey(null);
        return;
      }
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) {
        setRenamingThreadKey(null);
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      setRenamingThreadKey(null);
    },
    [],
  );

  const handleRowContextMenu = useCallback(
    async (
      thread: SidebarThreadSummary,
      threadRef: ScopedThreadRef,
      position: { x: number; y: number },
    ) => {
      const api = readLocalApi();
      if (!api) return;
      const project = selectProjectByRef(
        useStore.getState(),
        scopeProjectRef(thread.environmentId, thread.projectId),
      );
      const projectCwd = thread.worktreePath ?? project?.cwd ?? null;
      const threadKey = scopedThreadKey(threadRef);
      const items = [
        { id: "rename" as const, label: "Rename thread" },
        { id: "mark-unread" as const, label: "Mark unread" },
        { id: "archive" as const, label: "Archive" },
        ...(projectCwd ? [{ id: "copy-path" as const, label: "Copy Path" }] : []),
        { id: "copy-thread-id" as const, label: "Copy Thread ID" },
        { id: "delete" as const, label: "Delete", destructive: true },
      ];
      const clicked = await api.contextMenu.show(items, position);
      if (clicked === "rename") {
        beginRename(threadKey, thread.title);
        return;
      }
      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "archive") {
        try {
          await archiveThread(threadRef);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }
      if (clicked === "copy-path" && projectCwd) {
        copyPath(projectCwd, { path: projectCwd });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadId(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked === "delete") {
        if (appSettingsConfirmThreadDelete) {
          const confirmed = await api.dialogs.confirm(
            ["Delete thread?", "This permanently clears conversation history."].join("\n"),
          );
          if (!confirmed) return;
        }
        try {
          await deleteThread(threadRef);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to delete thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      }
    },
    [
      appSettingsConfirmThreadDelete,
      archiveThread,
      beginRename,
      copyPath,
      copyThreadId,
      deleteThread,
      markThreadUnread,
    ],
  );

  return (
    <SidebarContent className="gap-0">
      <SidebarGroup className="px-2 py-2">
        {buckets.length === 0 ? (
          <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
            No recent threads
          </div>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.id} className="mb-2">
              <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                {bucket.label}
              </div>
              <SidebarMenu>
                {bucket.threads.map((thread) => {
                  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
                  const threadKey = scopedThreadKey(threadRef);
                  return (
                    <RecentThreadRow
                      key={threadKey}
                      thread={thread}
                      threadRef={threadRef}
                      threadKey={threadKey}
                      isActive={routeThreadKey === threadKey}
                      isRenaming={renamingThreadKey === threadKey}
                      renamingTitle={renamingTitle}
                      setRenamingTitle={setRenamingTitle}
                      renamingCommittedRef={renamingCommittedRef}
                      commitRename={commitRename}
                      cancelRename={cancelRename}
                      navigateToThread={navigateToThread}
                      onContextMenu={handleRowContextMenu}
                    />
                  );
                })}
              </SidebarMenu>
            </div>
          ))
        )}
      </SidebarGroup>
    </SidebarContent>
  );
}

interface RecentThreadRowProps {
  thread: SidebarThreadSummary;
  threadRef: ScopedThreadRef;
  threadKey: string;
  isActive: boolean;
  isRenaming: boolean;
  renamingTitle: string;
  setRenamingTitle: (value: string) => void;
  renamingCommittedRef: React.RefObject<boolean>;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  onContextMenu: (
    thread: SidebarThreadSummary,
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
}

const RecentThreadRow = React.memo(function RecentThreadRow(props: RecentThreadRowProps) {
  const {
    thread,
    threadRef,
    threadKey,
    isActive,
    isRenaming,
    renamingTitle,
    setRenamingTitle,
    renamingCommittedRef,
    commitRename,
    cancelRename,
    navigateToThread,
    onContextMenu,
  } = props;

  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const project: Project | undefined = useStore((state) =>
    selectProjectByRef(state, scopeProjectRef(thread.environmentId, thread.projectId)),
  );
  const projectName = project?.name ?? "";

  const status = resolveThreadStatusPill({
    thread: { ...thread, lastVisitedAt },
  });

  const handleClick = useCallback(() => {
    navigateToThread(threadRef);
  }, [navigateToThread, threadRef]);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      void onContextMenu(thread, threadRef, { x: event.clientX, y: event.clientY });
    },
    [onContextMenu, thread, threadRef],
  );

  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleInputRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef],
  );

  const handleInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(threadRef, renamingTitle, thread.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef]);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );

  const baseClassName = resolveThreadRowClassName({
    isActive,
    isSelected: false,
  });

  const timeIso = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt ?? null;
  const timeLabel = timeIso ? formatRelativeTimeLabel(timeIso) : null;

  return (
    <li
      className={`group/menu-item relative w-full rounded-md ${
        isActive ? "" : "hover:bg-accent/40"
      }`}
      data-thread-item
      onContextMenu={handleContextMenu}
    >
      <div
        role="button"
        tabIndex={0}
        className={`${baseClassName} flex h-auto flex-col items-stretch gap-0.5 py-1.5`}
        onClick={isRenaming ? undefined : handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {isRenaming ? (
            <input
              ref={handleInputRef}
              value={renamingTitle}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onBlur={handleInputBlur}
              onClick={(e) => e.stopPropagation()}
              className="min-w-0 flex-1 rounded border border-border bg-background px-1 text-xs"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs">{thread.title || "Untitled"}</span>
          )}
          {status ? <StatusDot status={status} /> : null}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground/70">
          <span className="truncate">{projectName}</span>
          {timeLabel ? <span className="ml-auto shrink-0">{timeLabel}</span> : null}
        </div>
      </div>
    </li>
  );
});
