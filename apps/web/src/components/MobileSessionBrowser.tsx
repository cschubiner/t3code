import { Link } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  Clock3Icon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react";

import { derivePendingApprovals } from "../session-logic";
import { useStore } from "../store";
import type { Thread } from "../types";
import { Badge } from "./ui/badge";
import { cn } from "~/lib/utils";

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "No activity yet";

  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "Recently";

  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function statusBadge(thread: Thread): { label: string; className: string } | null {
  if (derivePendingApprovals(thread.activities).length > 0) {
    return {
      label: "Pending approval",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    };
  }

  if (thread.session?.orchestrationStatus === "running" || thread.session?.status === "running") {
    return {
      label: "Working",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-700",
    };
  }

  if (
    thread.session?.orchestrationStatus === "starting" ||
    thread.session?.status === "connecting"
  ) {
    return {
      label: "Connecting",
      className: "border-sky-500/30 bg-sky-500/10 text-sky-700",
    };
  }

  if (thread.latestTurn?.completedAt) {
    return {
      label: "Ready",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    };
  }

  return null;
}

function sortThreadsForProject(threads: Thread[]) {
  return threads.toSorted((left, right) => {
    const byCreatedAt = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (Number.isFinite(byCreatedAt) && byCreatedAt !== 0) {
      return byCreatedAt;
    }

    return right.id.localeCompare(left.id);
  });
}

export default function MobileSessionBrowser() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);

  if (!threadsHydrated) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background px-6 text-sm text-muted-foreground">
        <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
        Loading sessions...
      </div>
    );
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const orphanThreads = sortThreadsForProject(
    threads.filter((thread) => !projectIds.has(thread.projectId)),
  );
  const orderedProjects = projects;
  const hasAnyVisibleThreads = threads.length > 0;

  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6 pb-10 sm:px-6">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <div className="bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--color-sky-500)_14%,transparent),transparent_55%),linear-gradient(160deg,color-mix(in_srgb,var(--background)_35%,var(--color-black)),var(--background))] px-5 py-6">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              <SparklesIcon className="size-3.5" />
              Mobile Sessions
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Open a thread from your phone
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              This mobile surface points at the same live desktop backend, so you can browse
              current sessions and jump into the full thread view when needed.
            </p>
          </div>
        </section>

        {!hasAnyVisibleThreads ? (
          <section className="rounded-[24px] border border-dashed border-border bg-card/60 px-5 py-8 text-center">
            <MessageSquareTextIcon className="mx-auto size-8 text-muted-foreground/70" />
            <h2 className="mt-3 text-base font-medium">No sessions yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a thread in the main app, then reopen this mobile link to browse it here.
            </p>
          </section>
        ) : (
          [
            ...orderedProjects.map((project) => {
              const projectThreads = sortThreadsForProject(
                threads.filter((thread) => thread.projectId === project.id),
              );
              if (projectThreads.length === 0) {
                return null;
              }

              return (
                <section
                  key={project.id}
                  className="overflow-hidden rounded-[24px] border border-border bg-card"
                >
                  <header className="border-b border-border/80 px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-foreground">
                          {project.name}
                        </h2>
                      </div>
                      <Badge variant="outline">{projectThreads.length} threads</Badge>
                    </div>
                  </header>
                  <div className="divide-y divide-border/70">
                    {projectThreads.map((thread) => {
                      const badge = statusBadge(thread);
                      const activityLabel = formatRelativeTime(
                        thread.latestTurn?.completedAt ??
                          thread.latestTurn?.startedAt ??
                          thread.session?.updatedAt ??
                          thread.createdAt,
                      );

                      return (
                        <Link
                          key={thread.id}
                          to="/$threadId"
                          params={{ threadId: thread.id }}
                          className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-accent/40 active:bg-accent/60"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-sm font-medium text-foreground">
                                {thread.title}
                              </h3>
                              {badge ? (
                                <Badge className={cn("border", badge.className)}>{badge.label}</Badge>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{thread.model}</span>
                              <span className="inline-flex items-center gap-1">
                                <Clock3Icon className="size-3.5" />
                                {activityLabel}
                              </span>
                              {thread.session?.lastError ? (
                                <span className="inline-flex items-center gap-1 text-red-600">
                                  <ShieldAlertIcon className="size-3.5" />
                                  Attention needed
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            }),
            orphanThreads.length > 0 ? (
              <section
                key="orphan-threads"
                className="overflow-hidden rounded-[24px] border border-border bg-card"
              >
                <header className="border-b border-border/80 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-foreground">
                        Other Sessions
                      </h2>
                      <p className="truncate text-xs text-muted-foreground">
                        Threads without an active project record
                      </p>
                    </div>
                    <Badge variant="outline">{orphanThreads.length} threads</Badge>
                  </div>
                </header>
                <div className="divide-y divide-border/70">
                  {orphanThreads.map((thread) => {
                    const badge = statusBadge(thread);
                    const activityLabel = formatRelativeTime(
                      thread.latestTurn?.completedAt ??
                        thread.latestTurn?.startedAt ??
                        thread.session?.updatedAt ??
                        thread.createdAt,
                    );

                    return (
                      <Link
                        key={thread.id}
                        to="/$threadId"
                        params={{ threadId: thread.id }}
                        className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-accent/40 active:bg-accent/60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-sm font-medium text-foreground">
                              {thread.title}
                            </h3>
                            {badge ? (
                              <Badge className={cn("border", badge.className)}>{badge.label}</Badge>
                            ) : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{thread.model}</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3Icon className="size-3.5" />
                              {activityLabel}
                            </span>
                          </div>
                        </div>
                        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : null,
          ]
        )}
      </div>
    </div>
  );
}
