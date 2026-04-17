/**
 * CodexImport service — MVP read-only surface.
 *
 * Ported from the fork in a trimmed form. The fork tracked Codex session
 * metadata in Codex's own SQLite `history.db`, pulled cwd/title/timestamps
 * from there, and wrote back an "imported" flag. That side-DB integration
 * is out of scope for this commit.
 *
 * We keep the parseCodexTranscript parser from the fork (pure, identical
 * semantics) and use it + filesystem metadata (filename, file mtime) to
 * build session summaries. Enough for discovery + preview; full round-trip
 * "import as ClayCode thread" awaits a thread.import orchestration command.
 *
 *   • listSessions — walks ~/.codex/sessions/ for rollout-*.jsonl, parses
 *     headers, returns summaries sorted by file mtime desc
 *   • peekSession  — loads one transcript and returns the last N messages
 *   • importSessions — returns CodexImportError("not yet implemented")
 *
 * Tracked in docs/REBUILD_PLAN.md under "codex-import full import".
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CodexImportError,
  type CodexImportConcreteSessionKind,
  type CodexImportImportSessionsInput,
  type CodexImportImportSessionsResult,
  type CodexImportListSessionsInput,
  type CodexImportPeekSessionInput,
  type CodexImportPeekSessionResult,
  type CodexImportSessionSummary,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import {
  classifyCodexSessionKind,
  parseCodexTranscript,
  type ParsedCodexTranscript,
} from "../parseCodexTranscript";
import { CodexImport, type CodexImportShape } from "../Services/CodexImport";

const DEFAULT_RECENT_DAYS = 30;
const DEFAULT_RECENT_LIMIT = 50;
const DEFAULT_PEEK_MESSAGE_COUNT = 10;
const TITLE_MAX_CHARS = 80;

interface DiscoveredCodexRollout {
  readonly filePath: string;
  readonly sessionId: string;
  readonly mtimeMs: number;
}

function defaultCodexHome(explicit: string | undefined): string {
  return explicit ?? path.join(os.homedir(), ".codex");
}

function deriveSessionId(filename: string): string {
  // "rollout-2026-04-16T20-15-33.abc123.jsonl" → "abc123" or filename fallback
  const base = filename.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
  return base || filename;
}

async function discoverRollouts(sessionsRoot: string): Promise<DiscoveredCodexRollout[]> {
  let entries: Array<{ readonly fullPath: string; readonly filename: string }> = [];
  try {
    const rawEntries = await fs.readdir(sessionsRoot, { withFileTypes: true, recursive: true });
    entries = rawEntries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"),
      )
      .map((entry) => {
        const parentPath =
          (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
          (entry as unknown as { parentPath?: string; path?: string }).path ??
          sessionsRoot;
        return {
          fullPath: path.join(parentPath, entry.name),
          filename: entry.name,
        };
      });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }

  const withStats: DiscoveredCodexRollout[] = [];
  for (const { fullPath, filename } of entries) {
    try {
      const stat = await fs.stat(fullPath);
      withStats.push({
        filePath: fullPath,
        sessionId: deriveSessionId(filename),
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // Skip files we can't stat (permissions, symlink loops, etc.)
    }
  }
  return withStats;
}

async function loadTranscript(
  filePath: string,
): Promise<{ readonly parsed: ParsedCodexTranscript } | { readonly error: string }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseCodexTranscript(raw);
    return { parsed };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function firstUserMessageText(parsed: ParsedCodexTranscript): string | null {
  const first = parsed.messages.find((m) => m.role === "user");
  return first ? first.text : null;
}

function lastMessageText(parsed: ParsedCodexTranscript, role: "user" | "assistant"): string | null {
  for (let i = parsed.messages.length - 1; i >= 0; i -= 1) {
    const message = parsed.messages[i];
    if (message && message.role === role) return message.text;
  }
  return null;
}

function truncateForTitle(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (normalized.length <= TITLE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function buildSummary(
  rollout: DiscoveredCodexRollout,
  parsed: ParsedCodexTranscript,
): CodexImportSessionSummary {
  const firstMessage = firstUserMessageText(parsed);
  const title = firstMessage ? truncateForTitle(firstMessage) : rollout.sessionId;
  const kind: CodexImportConcreteSessionKind =
    classifyCodexSessionKind({ source: null, messages: parsed.messages }) ?? "direct";
  const earliestMs =
    parsed.messages.length > 0
      ? Math.min(
          ...parsed.messages.map((m) => Date.parse(m.createdAt)).filter((n) => Number.isFinite(n)),
        )
      : rollout.mtimeMs;
  const latestMs =
    parsed.messages.length > 0
      ? Math.max(
          ...parsed.messages.map((m) => Date.parse(m.updatedAt)).filter((n) => Number.isFinite(n)),
        )
      : rollout.mtimeMs;
  return {
    sessionId: rollout.sessionId,
    title,
    cwd: null,
    createdAt: Number.isFinite(earliestMs) ? iso(earliestMs) : iso(rollout.mtimeMs),
    updatedAt: Number.isFinite(latestMs) ? iso(latestMs) : iso(rollout.mtimeMs),
    model: parsed.model ?? null,
    kind,
    transcriptAvailable: true,
    transcriptError: null,
    alreadyImported: false,
    importedThreadId: null,
    lastUserMessage: lastMessageText(parsed, "user"),
    lastAssistantMessage: lastMessageText(parsed, "assistant"),
  };
}

const makeCodexImport = Effect.sync((): CodexImportShape => {
  const listSessions: CodexImportShape["listSessions"] = (input: CodexImportListSessionsInput) =>
    Effect.gen(function* () {
      const codexHome = defaultCodexHome(input.homePath);
      const sessionsRoot = path.join(codexHome, "sessions");
      const rollouts = yield* Effect.tryPromise({
        try: () => discoverRollouts(sessionsRoot),
        catch: (cause) =>
          new CodexImportError({
            message: `Failed to scan Codex sessions at ${sessionsRoot}: ${String(cause)}`,
          }),
      });
      const days = input.days ?? DEFAULT_RECENT_DAYS;
      const limit = input.limit ?? DEFAULT_RECENT_LIMIT;
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const recent = rollouts
        .filter((r) => r.mtimeMs >= cutoffMs)
        .toSorted((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(0, limit * 2); // over-pull for filter tolerance

      const summaries: CodexImportSessionSummary[] = [];
      for (const rollout of recent) {
        const loaded = yield* Effect.promise(() => loadTranscript(rollout.filePath));
        if ("error" in loaded) continue;
        const summary = buildSummary(rollout, loaded.parsed);
        if (input.kind !== "all" && summary.kind !== input.kind) continue;
        if (input.query) {
          const needle = input.query.toLowerCase();
          const haystack =
            `${summary.title} ${summary.lastUserMessage ?? ""} ${summary.lastAssistantMessage ?? ""}`.toLowerCase();
          if (!haystack.includes(needle)) continue;
        }
        summaries.push(summary);
        if (summaries.length >= limit) break;
      }
      return summaries;
    });

  const peekSession: CodexImportShape["peekSession"] = (input: CodexImportPeekSessionInput) =>
    Effect.gen(function* () {
      const codexHome = defaultCodexHome(input.homePath);
      const sessionsRoot = path.join(codexHome, "sessions");
      const rollouts = yield* Effect.tryPromise({
        try: () => discoverRollouts(sessionsRoot),
        catch: (cause) =>
          new CodexImportError({ message: `Failed to scan Codex sessions: ${String(cause)}` }),
      });
      const match = rollouts.find((r) => r.sessionId === input.sessionId);
      if (!match) {
        return yield* Effect.fail(
          new CodexImportError({ message: `Codex session not found: ${input.sessionId}` }),
        );
      }
      const loaded = yield* Effect.promise(() => loadTranscript(match.filePath));
      if ("error" in loaded) {
        return yield* Effect.fail(
          new CodexImportError({
            message: `Failed to read ${match.filePath}: ${loaded.error}`,
          }),
        );
      }
      const parsed = loaded.parsed;
      const messageCount = input.messageCount ?? DEFAULT_PEEK_MESSAGE_COUNT;
      const lastMessages = parsed.messages.slice(-messageCount);
      const summary = buildSummary(match, parsed);
      const result: CodexImportPeekSessionResult = {
        sessionId: match.sessionId,
        title: summary.title,
        cwd: null,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        model: parsed.model ?? null,
        runtimeMode: parsed.runtimeMode,
        interactionMode: parsed.interactionMode,
        kind: summary.kind,
        transcriptAvailable: true,
        transcriptError: null,
        alreadyImported: false,
        importedThreadId: null,
        messages: lastMessages.map((m) => ({
          role: m.role,
          text: m.text,
          createdAt: m.createdAt,
        })),
      };
      return result;
    });

  const importSessions: CodexImportShape["importSessions"] = (
    _input: CodexImportImportSessionsInput,
  ): Effect.Effect<CodexImportImportSessionsResult, CodexImportError> =>
    Effect.fail(
      new CodexImportError({
        message:
          "Importing Codex sessions as ClayCode threads is not yet available. Listing and previewing work today; import lands once the thread.import orchestration command is wired.",
      }),
    );

  return {
    listSessions,
    peekSession,
    importSessions,
  } satisfies CodexImportShape;
});

export const CodexImportLive = Layer.effect(CodexImport, makeCodexImport);
