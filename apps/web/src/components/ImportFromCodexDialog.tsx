import type {
  CodexImportSessionKind,
  CodexImportSessionSummary,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

import { readNativeApi } from "../nativeApi";
import { toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

interface ImportFromCodexDialogProps {
  open: boolean;
  codexHomePath: string;
  onOpenChange: (open: boolean) => void;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Unknown time";
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

function summarizeImportResult(input: {
  imported: number;
  skipped: number;
  failed: number;
}): string {
  return `${String(input.imported)} imported, ${String(input.skipped)} skipped, ${String(input.failed)} failed`;
}

const KIND_OPTIONS: ReadonlyArray<{ value: CodexImportSessionKind; label: string }> = [
  { value: "direct", label: "Direct" },
  { value: "subagent-child", label: "Subagent" },
  { value: "orchestrator", label: "Orchestrator" },
  { value: "all", label: "All" },
];

export function ImportFromCodexDialog({
  open,
  codexHomePath,
  onOpenChange,
}: ImportFromCodexDialogProps) {
  const api = readNativeApi();
  const navigate = useNavigate();
  const normalizedHomePath = codexHomePath.trim().length > 0 ? codexHomePath.trim() : undefined;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<CodexImportSessionKind>("direct");
  const [highlightedSessionId, setHighlightedSessionId] = useState<string | null>(null);
  const [selectedById, setSelectedById] = useState<Record<string, CodexImportSessionSummary>>({});
  const [debouncedQuery] = useDebouncedValue(query, { wait: 200 });

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setKind("direct");
    setHighlightedSessionId(null);
    setSelectedById({});
  }, [open]);

  const listInput = useMemo(
    () =>
      ({
        ...(normalizedHomePath ? { homePath: normalizedHomePath } : {}),
        kind,
        ...(debouncedQuery.trim().length > 0
          ? {
              query: debouncedQuery.trim(),
              limit: 100,
            }
          : {
              days: 30,
              limit: 50,
            }),
      }) as const,
    [debouncedQuery, kind, normalizedHomePath],
  );

  const listQuery = useQuery({
    queryKey: ["codexImport", "listSessions", listInput],
    enabled: open && api !== null,
    queryFn: async () => {
      if (!api) {
        throw new Error("The native API is unavailable.");
      }
      return api.codexImport.listSessions(listInput);
    },
  });

  useEffect(() => {
    if (!listQuery.data) {
      return;
    }
    setSelectedById((current) => {
      const nextEntries = listQuery.data
        .filter((session) => current[session.sessionId] !== undefined)
        .map((session) => [session.sessionId, session] as const);
      const next = Object.fromEntries(nextEntries);
      const currentIds = Object.keys(current);
      if (currentIds.length !== nextEntries.length) {
        return next;
      }
      return currentIds.every((sessionId) => next[sessionId] === current[sessionId])
        ? current
        : next;
    });
  }, [listQuery.data]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const visibleIds = new Set((listQuery.data ?? []).map((session) => session.sessionId));
    if (highlightedSessionId && visibleIds.has(highlightedSessionId)) {
      return;
    }
    setHighlightedSessionId(listQuery.data?.[0]?.sessionId ?? null);
  }, [highlightedSessionId, listQuery.data, open]);

  const previewQuery = useQuery({
    queryKey: ["codexImport", "peekSession", normalizedHomePath ?? "", highlightedSessionId],
    enabled: open && api !== null && highlightedSessionId !== null,
    queryFn: async () => {
      if (!api || !highlightedSessionId) {
        throw new Error("No Codex session is selected.");
      }
      return api.codexImport.peekSession({
        ...(normalizedHomePath ? { homePath: normalizedHomePath } : {}),
        sessionId: highlightedSessionId,
        messageCount: 10,
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (sessionIds: readonly string[]) => {
      if (!api) {
        throw new Error("The native API is unavailable.");
      }
      return api.codexImport.importSessions({
        ...(normalizedHomePath ? { homePath: normalizedHomePath } : {}),
        sessionIds: [...sessionIds],
      });
    },
    onSuccess: async (result) => {
      const imported = result.results.filter((entry) => entry.status === "imported");
      const skipped = result.results.filter((entry) => entry.status === "skipped-existing");
      const failed = result.results.filter((entry) => entry.status === "failed");
      const firstImportedThreadId = imported[0]?.threadId ?? null;

      toastManager.add({
        type: failed.length > 0 ? "warning" : imported.length > 0 ? "success" : "info",
        title: "Codex import complete",
        description: summarizeImportResult({
          imported: imported.length,
          skipped: skipped.length,
          failed: failed.length,
        }),
      });

      onOpenChange(false);
      if (firstImportedThreadId) {
        await navigate({
          to: "/$threadId",
          params: { threadId: firstImportedThreadId as ThreadId },
        });
      }
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Unable to import from Codex",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    },
  });

  const selectedSessions = useMemo(() => Object.values(selectedById), [selectedById]);
  const importableSelectedSessionIds = useMemo(
    () =>
      selectedSessions
        .filter((session) => session.transcriptAvailable && !session.alreadyImported)
        .map((session) => session.sessionId),
    [selectedSessions],
  );

  const handleRefresh = () => {
    void listQuery.refetch();
    if (highlightedSessionId) {
      void previewQuery.refetch();
    }
  };

  const toggleSelection = (session: CodexImportSessionSummary) => {
    setSelectedById((current) => {
      if (current[session.sessionId]) {
        const next = { ...current };
        delete next[session.sessionId];
        return next;
      }
      return { ...current, [session.sessionId]: session };
    });
  };

  const disabledImport =
    selectedSessions.length === 0 ||
    importableSelectedSessionIds.length === 0 ||
    importMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!importMutation.isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogPopup className="max-w-6xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Import From Codex</DialogTitle>
          <DialogDescription>
            Browse local Codex sessions, preview their visible text history, and import them into T3
            Code with a linked resume binding for the next turn.
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto p-6 pt-1 lg:flex lg:h-[min(72vh,42rem)] lg:flex-col lg:overflow-hidden"
          data-slot="dialog-panel"
        >
          <div className="grid gap-3 shrink-0 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
            <Input
              placeholder="Search title, prompt, or cwd"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as CodexImportSessionKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {KIND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={listQuery.isFetching || importMutation.isPending}
            >
              <RefreshCwIcon className={listQuery.isFetching ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>

          <div className="mt-4 grid min-h-[26rem] gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="overflow-hidden rounded-xl border lg:min-h-0">
              <ScrollArea data-testid="codex-import-session-list">
                <div className="divide-y">
                  {listQuery.isLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading Codex sessions…</div>
                  ) : listQuery.isError ? (
                    <div className="p-4 text-sm text-destructive-foreground">
                      {listQuery.error instanceof Error
                        ? listQuery.error.message
                        : "Unable to load Codex sessions."}
                    </div>
                  ) : (listQuery.data?.length ?? 0) === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      {debouncedQuery.trim().length > 0
                        ? "No Codex sessions matched this search."
                        : "No Codex sessions were found for this filter."}
                    </div>
                  ) : (
                    listQuery.data?.map((session) => {
                      const checked = selectedById[session.sessionId] !== undefined;
                      const isHighlighted = session.sessionId === highlightedSessionId;
                      return (
                        <button
                          key={session.sessionId}
                          type="button"
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                            isHighlighted ? "bg-accent/70" : "hover:bg-accent/40"
                          }`}
                          onClick={() => setHighlightedSessionId(session.sessionId)}
                        >
                          <input
                            aria-label={`Select ${session.title}`}
                            type="checkbox"
                            checked={checked}
                            disabled={!session.transcriptAvailable}
                            className="mt-1"
                            onChange={() => toggleSelection(session)}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate font-medium text-sm">{session.title}</span>
                              <Badge size="sm" variant="outline">
                                {session.kind === "subagent-child"
                                  ? "Subagent"
                                  : session.kind === "orchestrator"
                                    ? "Orchestrator"
                                    : "Direct"}
                              </Badge>
                              {session.alreadyImported ? (
                                <Badge size="sm" variant="secondary">
                                  Already imported
                                </Badge>
                              ) : null}
                              {!session.transcriptAvailable ? (
                                <Badge size="sm" variant="warning">
                                  Transcript unavailable
                                </Badge>
                              ) : null}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {session.cwd ?? "No working directory recorded"}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span>{formatTimestamp(session.updatedAt)}</span>
                              {session.model ? <span>{session.model}</span> : null}
                            </div>
                            {session.lastUserMessage ? (
                              <p className="line-clamp-1 text-xs text-foreground/80">
                                <span className="text-muted-foreground">User:</span>{" "}
                                {session.lastUserMessage}
                              </p>
                            ) : null}
                            {session.lastAssistantMessage ? (
                              <p className="line-clamp-1 text-xs text-foreground/70">
                                <span className="text-muted-foreground">Assistant:</span>{" "}
                                {session.lastAssistantMessage}
                              </p>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="overflow-hidden rounded-xl border lg:min-h-0">
              <ScrollArea data-testid="codex-import-session-preview">
                <div className="space-y-4 p-4">
                  {!highlightedSessionId ? (
                    <div className="text-sm text-muted-foreground">
                      Select a Codex session to preview its last importable messages.
                    </div>
                  ) : previewQuery.isLoading ? (
                    <div className="text-sm text-muted-foreground">Loading preview…</div>
                  ) : previewQuery.isError ? (
                    <div className="text-sm text-destructive-foreground">
                      {previewQuery.error instanceof Error
                        ? previewQuery.error.message
                        : "Unable to load preview."}
                    </div>
                  ) : previewQuery.data ? (
                    <>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-sm">{previewQuery.data.title}</h3>
                          <Badge size="sm" variant="outline">
                            {previewQuery.data.kind === "subagent-child"
                              ? "Subagent"
                              : previewQuery.data.kind === "orchestrator"
                                ? "Orchestrator"
                                : "Direct"}
                          </Badge>
                          {previewQuery.data.alreadyImported ? (
                            <Badge size="sm" variant="secondary">
                              Already imported
                            </Badge>
                          ) : null}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {previewQuery.data.cwd ?? "No working directory recorded"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {previewQuery.data.model ?? "Model unknown"} ·{" "}
                          {previewQuery.data.runtimeMode} · {previewQuery.data.interactionMode}
                        </div>
                      </div>

                      {!previewQuery.data.transcriptAvailable ? (
                        <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm text-warning-foreground">
                          {previewQuery.data.transcriptError ??
                            "Transcript is unavailable for this session."}
                        </div>
                      ) : null}

                      <div className="space-y-3">
                        {previewQuery.data.messages.length === 0 ? (
                          <div className="text-sm text-muted-foreground">
                            No importable text messages were found in this transcript.
                          </div>
                        ) : (
                          previewQuery.data.messages.map((message) => (
                            <div
                              key={`${message.role}-${message.createdAt}-${message.text}`}
                              className="space-y-1 rounded-lg border bg-background/70 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge size="sm" variant="outline">
                                  {message.role}
                                </Badge>
                                <span className="text-[11px] text-muted-foreground">
                                  {formatTimestamp(message.createdAt)}
                                </span>
                              </div>
                              <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
        <DialogFooter>
          <div className="mr-auto flex items-center text-sm text-muted-foreground">
            {selectedSessions.length === 0
              ? "No sessions selected"
              : `${String(selectedSessions.length)} selected`}
          </div>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate(importableSelectedSessionIds)}
            disabled={disabledImport}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
