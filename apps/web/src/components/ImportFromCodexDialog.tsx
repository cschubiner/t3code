/**
 * ImportFromCodexDialog
 *
 * Lists the user's Codex transcripts (`~/.codex/sessions/...rollout-*.jsonl`)
 * and lets the user import one as a new ClayCode draft thread.
 *
 * Implementation notes:
 * - Server's `importSessions` is a no-op acknowledgement (returns "imported"
 *   for each session). Real injection of past messages into the projection DB
 *   would require a new `thread.import.codex` orchestration command. See
 *   docs/REBUILD_PLAN.md.
 * - The actual "import" the user perceives is implemented client-side: we
 *   peek the full transcript, format it as markdown, create a new draft
 *   thread on the chosen project, pre-populate the composer with the
 *   formatted transcript so the user can review/edit/send, and navigate
 *   to the new draft.
 */
import type {
  CodexImportPeekSessionResult,
  CodexImportSessionSummary,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { ensureLocalApi } from "../localApi";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { newDraftId, newThreadId } from "../lib/utils";
import { deriveLogicalProjectKey } from "../logicalProject";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";

interface ImportFromCodexDialogProps {
  open: boolean;
  codexHomePath?: string;
  onOpenChange: (open: boolean) => void;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarize(text: string | null, maxChars = 120): string {
  if (!text) return "";
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function formatTranscriptAsMarkdown(peek: CodexImportPeekSessionResult): string {
  const header = [
    `# Imported from Codex: ${peek.title}`,
    peek.model ? `Model: ${peek.model}` : null,
    peek.updatedAt ? `Last updated: ${peek.updatedAt}` : null,
    "",
    "_Original transcript shown below. Continue the conversation as your next user message._",
    "",
    "---",
    "",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const body = peek.messages
    .map((m) => `**${m.role.toUpperCase()}** (${m.createdAt})\n\n${m.text}`)
    .join("\n\n---\n\n");
  return `${header}${body}\n`;
}

export function ImportFromCodexDialog({
  open,
  codexHomePath,
  onOpenChange,
}: ImportFromCodexDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [targetProjectKey, setTargetProjectKey] = useState<string | null>(null);

  const router = useRouter();

  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const projectsByKey = useMemo(() => {
    const map = new Map<string, { ref: ScopedProjectRef; name: string; logicalKey: string }>();
    for (const p of projects) {
      const ref = scopeProjectRef(p.environmentId, p.id);
      map.set(scopedProjectKey(ref), {
        ref,
        name: p.name,
        logicalKey: deriveLogicalProjectKey(p),
      });
    }
    return map;
  }, [projects]);

  // Default project selection: first project once projects are loaded.
  useEffect(() => {
    if (!open) return;
    if (targetProjectKey && projectsByKey.has(targetProjectKey)) return;
    const first = projects[0];
    if (first) {
      setTargetProjectKey(scopedProjectKey(scopeProjectRef(first.environmentId, first.id)));
    }
  }, [open, projects, projectsByKey, targetProjectKey]);

  const sessionsQuery = useQuery({
    queryKey: ["codexImport", "listSessions", codexHomePath ?? null],
    enabled: open,
    queryFn: async () => {
      const api = ensureLocalApi();
      const trimmedHome = codexHomePath?.trim();
      return api.codexImport.listSessions({
        ...(trimmedHome ? { homePath: trimmedHome } : {}),
        kind: "direct",
      });
    },
    staleTime: 30_000,
  });

  const filteredSessions = useMemo<readonly CodexImportSessionSummary[]>(() => {
    const all = sessionsQuery.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((session) => {
      const haystack =
        `${session.title} ${session.lastUserMessage ?? ""} ${session.lastAssistantMessage ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [sessionsQuery.data, query]);

  const peekQuery = useQuery({
    queryKey: ["codexImport", "peekSession", selectedSessionId, codexHomePath ?? null],
    enabled: open && selectedSessionId !== null,
    queryFn: async () => {
      if (!selectedSessionId) return null;
      const api = ensureLocalApi();
      const trimmedHome = codexHomePath?.trim();
      return api.codexImport.peekSession({
        ...(trimmedHome ? { homePath: trimmedHome } : {}),
        sessionId: selectedSessionId,
        // Pull a generous slice for import preview; backend caps anyway.
        messageCount: 200,
      });
    },
    staleTime: 60_000,
  });

  const importMutation = useMutation({
    mutationFn: async ({
      peek,
      projectRef,
      logicalKey,
    }: {
      peek: CodexImportPeekSessionResult;
      projectRef: ScopedProjectRef;
      logicalKey: string;
    }) => {
      const api = ensureLocalApi();
      const trimmedHome = codexHomePath?.trim();
      // Acknowledge with server (no-op today; reserved for future
      // server-side projection writes via thread.import.codex).
      await api.codexImport.importSessions({
        ...(trimmedHome ? { homePath: trimmedHome } : {}),
        sessionIds: [peek.sessionId],
      });

      const transcript = formatTranscriptAsMarkdown(peek);
      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      const draftStore = useComposerDraftStore.getState();
      draftStore.setLogicalProjectDraftThreadId(logicalKey, projectRef, draftId, {
        threadId,
        createdAt,
        branch: null,
        worktreePath: null,
        envMode: "local",
      });
      draftStore.setPrompt(draftId as DraftId, transcript);

      await router.navigate({ to: "/draft/$draftId", params: { draftId } });
      return { draftId };
    },
    onSuccess: () => {
      toastManager.add({
        type: "success",
        title: "Imported as new draft thread",
        description:
          "Codex transcript loaded into the composer. Review, then send to start the conversation.",
      });
      onOpenChange(false);
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to import Codex session",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });

  const handleImportClick = () => {
    const peek = peekQuery.data;
    if (!peek) return;
    if (!targetProjectKey) {
      toastManager.add({
        type: "warning",
        title: "Choose a target project first",
      });
      return;
    }
    const target = projectsByKey.get(targetProjectKey);
    if (!target) {
      toastManager.add({
        type: "error",
        title: "Selected project no longer exists",
      });
      return;
    }
    importMutation.mutate({
      peek,
      projectRef: target.ref,
      logicalKey: target.logicalKey,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-5xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Import from Codex</DialogTitle>
          <DialogDescription>
            Browse Codex transcripts and import one as a new ClayCode draft thread. The transcript
            is pre-loaded into the composer so you can review, edit, and continue the conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[320px_1fr] gap-4" style={{ height: 480 }}>
          {/* Left: list */}
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                type="search"
                placeholder="Search Codex sessions"
                data-testid="codex-import-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => void sessionsQuery.refetch()}
                aria-label="Refresh Codex sessions"
                title="Refresh"
              >
                <RefreshCwIcon className="size-3.5" />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
              {sessionsQuery.isLoading ? (
                <div className="p-3 text-xs text-muted-foreground">Loading…</div>
              ) : sessionsQuery.isError ? (
                <div className="p-3 text-xs text-destructive">
                  {(sessionsQuery.error as Error).message}
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">No Codex transcripts found.</div>
              ) : (
                <ul className="flex flex-col">
                  {filteredSessions.map((session) => {
                    const active = selectedSessionId === session.sessionId;
                    return (
                      <li key={session.sessionId}>
                        <button
                          type="button"
                          onClick={() => setSelectedSessionId(session.sessionId)}
                          className={
                            "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50" +
                            (active ? " bg-muted/70" : "")
                          }
                        >
                          <span
                            className="truncate font-medium text-foreground"
                            title={session.title}
                          >
                            {session.title}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatTimestamp(session.updatedAt)}
                            {session.model ? ` · ${session.model}` : ""}
                          </span>
                          {session.lastUserMessage ? (
                            <span className="truncate text-[11px] text-muted-foreground/80">
                              {summarize(session.lastUserMessage, 72)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </div>

          {/* Right: peek */}
          <div className="flex min-h-0 flex-col gap-2">
            {!selectedSessionId ? (
              <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                Select a session to preview
              </div>
            ) : peekQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                Loading…
              </div>
            ) : peekQuery.isError ? (
              <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-destructive">
                {(peekQuery.error as Error).message}
              </div>
            ) : peekQuery.data ? (
              <PeekPanel
                peek={peekQuery.data}
                projects={projects.map((p) => {
                  const ref = scopeProjectRef(p.environmentId, p.id);
                  return {
                    key: scopedProjectKey(ref),
                    name: p.name,
                  };
                })}
                targetProjectKey={targetProjectKey}
                onTargetProjectChange={setTargetProjectKey}
                onImport={handleImportClick}
                importPending={importMutation.isPending}
                importDisabled={
                  !targetProjectKey || projects.length === 0 || importMutation.isPending
                }
              />
            ) : null}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function PeekPanel({
  peek,
  projects,
  targetProjectKey,
  onTargetProjectChange,
  onImport,
  importPending,
  importDisabled,
}: {
  peek: CodexImportPeekSessionResult;
  projects: ReadonlyArray<{ key: string; name: string }>;
  targetProjectKey: string | null;
  onTargetProjectChange: (key: string) => void;
  onImport: () => void;
  importPending: boolean;
  importDisabled: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{peek.title}</span>
          <span className="text-[11px] text-muted-foreground">
            {formatTimestamp(peek.updatedAt)}
            {peek.model ? ` · ${peek.model}` : ""}
            {peek.kind ? (
              <Badge variant="outline" className="ml-2">
                {peek.kind}
              </Badge>
            ) : null}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {projects.length > 0 ? (
            <select
              className="h-8 max-w-[180px] rounded-md border border-border bg-background px-2 text-xs"
              value={targetProjectKey ?? ""}
              onChange={(e) => onTargetProjectChange(e.target.value)}
              aria-label="Target project"
              data-testid="codex-import-target-project"
            >
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] text-muted-foreground">No projects available</span>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onImport}
            disabled={importDisabled}
            data-testid="codex-import-submit"
          >
            {importPending ? "Importing…" : "Import as draft"}
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
        <div className="flex flex-col gap-2 p-3 text-xs">
          {peek.messages.map((message, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key -- transcript messages have no stable ID
              key={`${message.createdAt}-${index}`}
              className={
                "rounded-md p-2 " +
                (message.role === "user"
                  ? "bg-muted/40 text-foreground"
                  : message.role === "assistant"
                    ? "bg-primary/10 text-foreground"
                    : "bg-muted/20 text-muted-foreground")
              }
            >
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {message.role}
              </div>
              <div className="whitespace-pre-wrap break-words">{message.text}</div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}
