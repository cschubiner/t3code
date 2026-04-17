/**
 * ImportFromCodexDialog — read-only MVP.
 *
 * Lists the user's Codex transcripts (`~/.codex/sessions/**\/rollout-*.jsonl`)
 * and lets them preview one. Actually importing a session as a ClayCode
 * thread returns a "not yet implemented" error from the server; the dialog
 * surfaces that clearly rather than pretending to work.
 *
 * Ported from the fork's full dialog, simplified to skip the import-actions
 * column and the session-kind tabs (since the backing query is currently
 * just "direct"+filter). Once we wire the `thread.import` orchestration
 * command, the Import button path can be re-enabled.
 */
import type { CodexImportPeekSessionResult, CodexImportSessionSummary } from "@t3tools/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { ensureLocalApi } from "../localApi";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

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

export function ImportFromCodexDialog({
  open,
  codexHomePath,
  onOpenChange,
}: ImportFromCodexDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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
      });
    },
    staleTime: 60_000,
  });

  const importMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const api = ensureLocalApi();
      const trimmedHome = codexHomePath?.trim();
      return api.codexImport.importSessions({
        ...(trimmedHome ? { homePath: trimmedHome } : {}),
        sessionIds: [sessionId],
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-5xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <DialogTitle>Import from Codex</DialogTitle>
          <DialogDescription>
            Browse Codex transcripts and preview them. Full import as a ClayCode thread will land
            once the thread.import orchestration command is wired.
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
                onImport={() => importMutation.mutate(peekQuery.data!.sessionId)}
                importPending={importMutation.isPending}
                importError={
                  importMutation.error instanceof Error ? importMutation.error.message : null
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
  onImport,
  importPending,
  importError,
}: {
  peek: CodexImportPeekSessionResult;
  onImport: () => void;
  importPending: boolean;
  importError: string | null;
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
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onImport}
          disabled={importPending}
          title="Importing is not yet implemented; this will show the server's response."
        >
          {importPending ? "Importing…" : "Import (stub)"}
        </Button>
      </div>
      {importError ? (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
          {importError}
        </div>
      ) : null}
      <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
        <div className="flex flex-col gap-2 p-3 text-xs">
          {peek.messages.map((message, index) => (
            <div
              key={index}
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
