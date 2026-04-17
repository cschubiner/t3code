import type {
  CodexImportPeekSessionResult,
  CodexImportSessionSummary,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { deriveLogicalProjectKey } from "../logicalProject";
import { ensureLocalApi } from "../localApi";
import { newDraftId, newThreadId } from "../lib/utils";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { buildDraftThreadRouteParams } from "../threadRoutes";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";
import { toastManager } from "./ui/toast";
import { cn } from "~/lib/utils";

interface ImportFromCodexDialogProps {
  readonly open: boolean;
  readonly codexHomePath?: string;
  readonly preferredProjectRef?: ScopedProjectRef | null;
  readonly onOpenChange: (open: boolean) => void;
}

interface ImportTargetProject {
  readonly key: string;
  readonly ref: ScopedProjectRef;
  readonly name: string;
  readonly logicalProjectKey: string;
  readonly environmentLabel: string;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarize(text: string | null, maxChars = 160): string {
  if (!text) {
    return "";
  }
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function formatTranscriptAsMarkdown(peek: CodexImportPeekSessionResult): string {
  const headerLines = [
    `# Imported from Codex: ${peek.title}`,
    peek.model ? `Model: ${peek.model}` : null,
    peek.updatedAt ? `Last updated: ${peek.updatedAt}` : null,
    "",
    "_Original Codex transcript below. Review or edit it, then send to continue the conversation._",
    "",
    "---",
    "",
  ].filter((line): line is string => line !== null);

  const body = peek.messages
    .map((message) => `**${message.role.toUpperCase()}** (${message.createdAt})\n\n${message.text}`)
    .join("\n\n---\n\n");

  return `${headerLines.join("\n")}${body ? `\n${body}\n` : "\n"}`;
}

export function ImportFromCodexDialog(props: ImportFromCodexDialogProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [targetProjectKey, setTargetProjectKey] = useState<string | null>(null);

  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const projectOptions = useMemo<ImportTargetProject[]>(() => {
    return projects
      .map((project) => {
        const ref = scopeProjectRef(project.environmentId, project.id);
        return {
          key: scopedProjectKey(ref),
          ref,
          name: project.name,
          logicalProjectKey: deriveLogicalProjectKey(project),
          environmentLabel: project.environmentId,
        };
      })
      .toSorted((left, right) => {
        const nameComparison = left.name.localeCompare(right.name);
        if (nameComparison !== 0) {
          return nameComparison;
        }
        return left.environmentLabel.localeCompare(right.environmentLabel);
      });
  }, [projects]);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setSelectedSessionId(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [props.open]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    const preferredKey = props.preferredProjectRef
      ? scopedProjectKey(props.preferredProjectRef)
      : null;
    if (preferredKey && projectOptions.some((project) => project.key === preferredKey)) {
      setTargetProjectKey(preferredKey);
      return;
    }

    if (targetProjectKey && projectOptions.some((project) => project.key === targetProjectKey)) {
      return;
    }

    setTargetProjectKey(projectOptions[0]?.key ?? null);
  }, [projectOptions, props.open, props.preferredProjectRef, targetProjectKey]);

  const sessionsQuery = useQuery({
    queryKey: ["codex-import", "sessions", props.codexHomePath ?? null],
    enabled: props.open,
    staleTime: 30_000,
    queryFn: async () => {
      const homePath = props.codexHomePath?.trim();
      return ensureLocalApi().codexImport.listSessions({
        ...(homePath ? { homePath } : {}),
        kind: "all",
      });
    },
  });

  const filteredSessions = useMemo<readonly CodexImportSessionSummary[]>(() => {
    const allSessions = sessionsQuery.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return allSessions;
    }
    return allSessions.filter((session) => {
      const haystack = [
        session.title,
        session.lastUserMessage ?? "",
        session.lastAssistantMessage ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [query, sessionsQuery.data]);

  useEffect(() => {
    if (!props.open) {
      return;
    }

    if (
      selectedSessionId &&
      filteredSessions.some((session) => session.sessionId === selectedSessionId)
    ) {
      return;
    }

    setSelectedSessionId(filteredSessions[0]?.sessionId ?? null);
  }, [filteredSessions, props.open, selectedSessionId]);

  const selectedSession = useMemo(
    () => filteredSessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [filteredSessions, selectedSessionId],
  );

  const peekQuery = useQuery({
    queryKey: ["codex-import", "peek", selectedSessionId, props.codexHomePath ?? null],
    enabled: props.open && selectedSessionId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      if (!selectedSessionId) {
        return null;
      }
      const homePath = props.codexHomePath?.trim();
      return ensureLocalApi().codexImport.peekSession({
        ...(homePath ? { homePath } : {}),
        sessionId: selectedSessionId,
        messageCount: 200,
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (input: {
      readonly project: ImportTargetProject;
      readonly peek: CodexImportPeekSessionResult;
    }) => {
      const homePath = props.codexHomePath?.trim();
      await ensureLocalApi().codexImport.importSessions({
        ...(homePath ? { homePath } : {}),
        sessionIds: [input.peek.sessionId],
      });

      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const transcript = formatTranscriptAsMarkdown(input.peek);
      const draftStore = useComposerDraftStore.getState();

      draftStore.setLogicalProjectDraftThreadId(
        input.project.logicalProjectKey,
        input.project.ref,
        draftId,
        {
          threadId,
          createdAt,
          runtimeMode: input.peek.runtimeMode,
          interactionMode: input.peek.interactionMode,
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      );
      draftStore.setPrompt(draftId as DraftId, transcript);

      await navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(draftId),
      });
    },
    onSuccess: () => {
      toastManager.add({
        type: "success",
        title: "Imported into a draft thread",
        description: "The Codex transcript is loaded into the composer for review and editing.",
      });
      props.onOpenChange(false);
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to import Codex transcript",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    },
  });

  const previewMessages = useMemo(() => {
    const seenKeys = new Map<string, number>();
    return (peekQuery.data?.messages ?? []).map((message) => {
      const normalizedText = message.text.trim().replace(/\s+/g, " ").slice(0, 120);
      const baseKey = [message.createdAt, message.role, normalizedText].join(":");
      const duplicateCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, duplicateCount + 1);
      return {
        key: duplicateCount === 0 ? baseKey : `${baseKey}:${duplicateCount}`,
        message,
      };
    });
  }, [peekQuery.data?.messages]);

  const handleImport = () => {
    const peek = peekQuery.data;
    const project = projectOptions.find((option) => option.key === targetProjectKey) ?? null;
    if (!peek || !project) {
      return;
    }
    importMutation.mutate({ peek, project });
  };

  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onOpenChange(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredSessions.length === 0) {
        return;
      }
      const currentIndex = Math.max(
        0,
        filteredSessions.findIndex((session) => session.sessionId === selectedSessionId),
      );
      const nextIndex = (currentIndex + 1) % filteredSessions.length;
      setSelectedSessionId(filteredSessions[nextIndex]?.sessionId ?? null);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredSessions.length === 0) {
        return;
      }
      const currentIndex = Math.max(
        0,
        filteredSessions.findIndex((session) => session.sessionId === selectedSessionId),
      );
      const nextIndex = (currentIndex - 1 + filteredSessions.length) % filteredSessions.length;
      setSelectedSessionId(filteredSessions[nextIndex]?.sessionId ?? null);
      return;
    }

    if (event.key === "Enter" && peekQuery.data && targetProjectKey) {
      event.preventDefault();
      handleImport();
    }
  };

  const importDisabled =
    importMutation.isPending ||
    peekQuery.data === null ||
    peekQuery.isPending ||
    targetProjectKey === null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-6xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Import from Codex</DialogTitle>
          <DialogDescription>
            Browse local Codex transcripts and load one into a new draft thread so you can review,
            edit, and continue it here.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  type="search"
                  placeholder="Search Codex sessions"
                  data-testid="codex-import-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onQueryKeyDown}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Refresh Codex sessions"
                  onClick={() => {
                    void sessionsQuery.refetch();
                  }}
                  disabled={sessionsQuery.isFetching}
                >
                  <RefreshCwIcon
                    className={cn("size-4", sessionsQuery.isFetching && "animate-spin")}
                  />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                <span>
                  {filteredSessions.length === 0
                    ? "No sessions found"
                    : `${filteredSessions.length} session${filteredSessions.length === 1 ? "" : "s"}`}
                </span>
                <span>Enter imports • Up/Down moves • Esc closes</span>
              </div>
              <div className="min-h-[24rem] overflow-hidden rounded-xl border">
                <ScrollArea>
                  <div className="divide-y">
                    {sessionsQuery.isPending ? (
                      <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
                        <Spinner className="size-4" />
                        Loading Codex sessions…
                      </div>
                    ) : sessionsQuery.isError ? (
                      <div className="p-4 text-destructive text-sm">
                        {sessionsQuery.error instanceof Error
                          ? sessionsQuery.error.message
                          : "Unable to load Codex sessions."}
                      </div>
                    ) : filteredSessions.length === 0 ? (
                      <div className="p-4 text-muted-foreground text-sm">
                        No Codex transcripts matched this search.
                      </div>
                    ) : (
                      filteredSessions.map((session) => {
                        const isSelected = session.sessionId === selectedSessionId;
                        return (
                          <button
                            key={session.sessionId}
                            type="button"
                            data-codex-import-session={session.sessionId}
                            data-selected={isSelected ? "true" : undefined}
                            className={cn(
                              "flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors",
                              isSelected ? "bg-accent/70" : "hover:bg-accent/40",
                            )}
                            onMouseEnter={() => setSelectedSessionId(session.sessionId)}
                            onClick={() => setSelectedSessionId(session.sessionId)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="truncate font-medium text-sm">{session.title}</div>
                                <div className="text-muted-foreground text-xs">
                                  {session.kind.replace("-", " ")} •{" "}
                                  {formatTimestamp(session.updatedAt)}
                                </div>
                              </div>
                            </div>
                            <p className="line-clamp-2 text-muted-foreground text-sm">
                              {summarize(session.lastUserMessage || session.lastAssistantMessage)}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-xl border">
              <div className="border-b px-4 py-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
                  <div className="space-y-1">
                    <div className="font-medium text-sm">
                      {selectedSession?.title ?? "Select a session"}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {selectedSession
                        ? `${selectedSession.kind.replace("-", " ")} session • Updated ${formatTimestamp(selectedSession.updatedAt)}`
                        : "Choose a session from the list to preview it."}
                    </div>
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="font-medium text-foreground text-xs">Target project</span>
                    <Select
                      value={targetProjectKey ?? ""}
                      onValueChange={(value) => setTargetProjectKey(value)}
                      disabled={projectOptions.length === 0}
                    >
                      <SelectTrigger aria-label="Target project" className="w-full">
                        <SelectValue>
                          {projectOptions.find((project) => project.key === targetProjectKey)
                            ?.name ?? "Choose project"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.key} value={project.key}>
                            {project.name} ({project.environmentLabel})
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </label>
                </div>
              </div>

              <div className="min-h-0 flex-1">
                <ScrollArea>
                  {!selectedSession ? (
                    <div className="p-4 text-muted-foreground text-sm">
                      Select a Codex session to inspect its transcript preview.
                    </div>
                  ) : peekQuery.isPending ? (
                    <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
                      <Loader2Icon className="size-4 animate-spin" />
                      Loading transcript preview…
                    </div>
                  ) : peekQuery.isError ? (
                    <div className="p-4 text-destructive text-sm">
                      {peekQuery.error instanceof Error
                        ? peekQuery.error.message
                        : "Unable to load this Codex transcript."}
                    </div>
                  ) : peekQuery.data ? (
                    <div className="space-y-4 p-4">
                      <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                        <div>
                          <div className="text-muted-foreground text-xs">Model</div>
                          <div>{peekQuery.data.model ?? "Unknown"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Messages</div>
                          <div>{peekQuery.data.messages.length}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Runtime mode</div>
                          <div>{peekQuery.data.runtimeMode}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Interaction mode</div>
                          <div>{peekQuery.data.interactionMode}</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {previewMessages.length === 0 ? (
                          <div className="text-muted-foreground text-sm">
                            This transcript did not include any messages.
                          </div>
                        ) : (
                          previewMessages.map(({ key, message }) => (
                            <article key={key} className="space-y-1 rounded-xl border p-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-sm uppercase tracking-wide">
                                  {message.role}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                  {formatTimestamp(message.createdAt)}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap break-words text-sm">
                                {message.text}
                              </p>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </ScrollArea>
              </div>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <div className="mr-auto text-muted-foreground text-xs">
            Imported transcripts open as draft threads so you can review them before sending.
          </div>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={importDisabled}
            data-testid="codex-import-confirm"
          >
            {importMutation.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Import into draft
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
