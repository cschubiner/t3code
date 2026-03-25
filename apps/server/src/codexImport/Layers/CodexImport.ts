import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  ProjectId,
  ThreadId,
  type CodexImportConcreteSessionKind,
  type CodexImportImportSessionsResult,
  type CodexImportListSessionsInput,
  type CodexImportPeekSessionResult,
  type CodexImportSessionSummary,
  type OrchestrationReadModel,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadImportCommand,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";

import { ServerConfig } from "../../config.ts";
import { GitCore } from "../../git/Services/GitCore.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import {
  classifyCodexSessionKind,
  CodexTranscriptParseError,
  parseCodexTranscript,
  type ParsedCodexTranscript,
} from "../parseCodexTranscript.ts";
import { CodexImport, CodexImportError, type CodexImportShape } from "../Services/CodexImport.ts";

const DEFAULT_RECENT_DAYS = 30;
const DEFAULT_RECENT_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 100;
const DEFAULT_PEEK_MESSAGE_COUNT = 10;
const LIST_MESSAGE_TAIL_WINDOW = 24;

const FALLBACK_PROJECT_ID = ProjectId.makeUnsafe("codex-import-fallback");
const FALLBACK_PROJECT_TITLE = "Imported from Codex";

interface CodexThreadRow {
  readonly id: string;
  readonly title: string | null;
  readonly cwd: string | null;
  readonly updatedAt: string | null;
  readonly createdAt: string | null;
  readonly source: string | null;
  readonly rolloutPath: string | null;
  readonly firstUserMessage: string | null;
  readonly archived: number | null;
}

type RawCodexThreadRow = Omit<CodexThreadRow, "updatedAt" | "createdAt"> & {
  readonly updatedAt: unknown;
  readonly createdAt: unknown;
};

interface CodexHomeResolution {
  readonly homePath: string;
  readonly databasePath: string;
  readonly isDefaultHomePath: boolean;
}

interface CanonicalWorkspace {
  readonly projectWorkspaceRoot: string;
  readonly originalCwd: string;
  readonly worktreePath: string | null;
}

interface ImportedThreadRuntimeBinding {
  readonly threadId: ThreadId;
  readonly cwd: string;
}

function toError(message: string): CodexImportError {
  return new CodexImportError({ message });
}

function toCodexImportError(error: unknown, fallback: string): CodexImportError {
  if (Schema.is(CodexImportError)(error)) {
    return error;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return toError(error.message);
  }
  return toError(fallback);
}

function sanitizeTitle(title: string | null | undefined, sessionId: string): string {
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed;
  }
  return `Imported Codex Session ${sessionId.slice(0, 8)}`;
}

function toCanonicalThreadId(sessionId: string): ThreadId {
  return ThreadId.makeUnsafe(`codex-import-${sessionId}`);
}

function toMessageId(sessionId: string, index: number): MessageId {
  return MessageId.makeUnsafe(`codex-import-${sessionId}-message-${String(index + 1)}`);
}

function scoreTokens(haystack: string, tokens: ReadonlyArray<string>): number {
  if (tokens.length === 0) {
    return 0;
  }
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function isConcreteKind(
  kind: CodexImportListSessionsInput["kind"],
): kind is CodexImportConcreteSessionKind {
  return kind !== "all";
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function statIsDirectory(targetPath: string): Promise<boolean> {
  try {
    const result = await fs.stat(targetPath);
    return result.isDirectory();
  } catch {
    return false;
  }
}

async function statIsFile(targetPath: string): Promise<boolean> {
  try {
    const result = await fs.stat(targetPath);
    return result.isFile();
  } catch {
    return false;
  }
}

function resolveRolloutPath(homePath: string, rolloutPath: string | null): string | null {
  if (!rolloutPath) {
    return null;
  }
  return path.isAbsolute(rolloutPath) ? rolloutPath : path.join(homePath, rolloutPath);
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return normalizeTimestamp(
      /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : new Date(trimmed),
    );
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    const timestampMs = Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
    const timestamp = new Date(timestampMs);
    return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  return null;
}

function normalizeThreadRow(row: RawCodexThreadRow): CodexThreadRow {
  return {
    ...row,
    createdAt: normalizeTimestamp(row.createdAt),
    updatedAt: normalizeTimestamp(row.updatedAt),
  };
}

function openCodexDatabase(databasePath: string): DatabaseSync {
  return new DatabaseSync(databasePath, { readOnly: true });
}

function readThreadRows(databasePath: string): CodexThreadRow[] {
  const database = openCodexDatabase(databasePath);
  try {
    const statement = database.prepare(`
      SELECT
        id,
        title,
        cwd,
        updated_at AS updatedAt,
        created_at AS createdAt,
        source,
        rollout_path AS rolloutPath,
        first_user_message AS firstUserMessage,
        archived
      FROM threads
      ORDER BY updated_at DESC, created_at DESC, id DESC
    `);
    return (statement.all() as RawCodexThreadRow[]).map(normalizeThreadRow);
  } finally {
    database.close();
  }
}

function readThreadRowById(databasePath: string, sessionId: string): CodexThreadRow | null {
  const database = openCodexDatabase(databasePath);
  try {
    const statement = database.prepare(`
      SELECT
        id,
        title,
        cwd,
        updated_at AS updatedAt,
        created_at AS createdAt,
        source,
        rollout_path AS rolloutPath,
        first_user_message AS firstUserMessage,
        archived
      FROM threads
      WHERE id = ?
      LIMIT 1
    `);
    const row = (statement.get(sessionId) as RawCodexThreadRow | undefined) ?? null;
    return row ? normalizeThreadRow(row) : null;
  } finally {
    database.close();
  }
}

async function resolveCodexHome(rawHomePath: string | undefined): Promise<CodexHomeResolution> {
  const defaultHomePath = path.join(os.homedir(), ".codex");
  const requestedHomePath = rawHomePath?.trim() ? rawHomePath.trim() : "~/.codex";
  const expandedHomePath =
    requestedHomePath === "~"
      ? os.homedir()
      : requestedHomePath.startsWith("~/") || requestedHomePath.startsWith("~\\")
        ? path.join(os.homedir(), requestedHomePath.slice(2))
        : requestedHomePath;
  const homePath = path.resolve(expandedHomePath);
  const databasePath = path.join(homePath, "state_5.sqlite");

  if (!(await statIsDirectory(homePath))) {
    throw toError(`Codex home not found at ${homePath}.`);
  }
  if (!(await statIsFile(databasePath))) {
    throw toError(`Codex session index not found at ${databasePath}.`);
  }

  return {
    homePath,
    databasePath,
    isDefaultHomePath: homePath === defaultHomePath,
  };
}

async function readTranscriptSummary(input: {
  readonly homePath: string;
  readonly row: CodexThreadRow;
}): Promise<
  | {
      readonly transcriptAvailable: true;
      readonly transcriptError: null;
      readonly parsed: ParsedCodexTranscript;
      readonly kind: CodexImportConcreteSessionKind;
      readonly lastUserMessage: string | null;
      readonly lastAssistantMessage: string | null;
    }
  | {
      readonly transcriptAvailable: false;
      readonly transcriptError: string;
      readonly parsed: ParsedCodexTranscript | null;
      readonly kind: CodexImportConcreteSessionKind;
      readonly lastUserMessage: string | null;
      readonly lastAssistantMessage: string | null;
    }
> {
  const resolvedRolloutPath = resolveRolloutPath(input.homePath, input.row.rolloutPath);
  if (!resolvedRolloutPath) {
    return {
      transcriptAvailable: false,
      transcriptError: "Transcript path is missing for this Codex session.",
      parsed: null,
      kind: classifyCodexSessionKind({ source: input.row.source, messages: [] }),
      lastUserMessage: null,
      lastAssistantMessage: null,
    };
  }

  if (path.extname(resolvedRolloutPath) !== ".jsonl") {
    return {
      transcriptAvailable: false,
      transcriptError: `Transcript file must be a .jsonl rollout, received ${resolvedRolloutPath}.`,
      parsed: null,
      kind: classifyCodexSessionKind({ source: input.row.source, messages: [] }),
      lastUserMessage: null,
      lastAssistantMessage: null,
    };
  }

  if (!(await exists(resolvedRolloutPath))) {
    return {
      transcriptAvailable: false,
      transcriptError: `Transcript file not found at ${resolvedRolloutPath}.`,
      parsed: null,
      kind: classifyCodexSessionKind({ source: input.row.source, messages: [] }),
      lastUserMessage: null,
      lastAssistantMessage: null,
    };
  }

  try {
    const transcript = await fs.readFile(resolvedRolloutPath, "utf8");
    const parsed = parseCodexTranscript(transcript, {
      messageWindow: LIST_MESSAGE_TAIL_WINDOW,
    });
    const kind = classifyCodexSessionKind({
      source: input.row.source,
      messages: parsed.messages,
    });
    const lastUserMessage =
      parsed.messages.toReversed().find((message) => message.role === "user")?.text ?? null;
    const lastAssistantMessage =
      parsed.messages.toReversed().find((message) => message.role === "assistant")?.text ?? null;

    return {
      transcriptAvailable: true,
      transcriptError: null,
      parsed,
      kind,
      lastUserMessage,
      lastAssistantMessage,
    };
  } catch (error) {
    const detail =
      error instanceof CodexTranscriptParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to read transcript.";
    return {
      transcriptAvailable: false,
      transcriptError: detail,
      parsed: null,
      kind: classifyCodexSessionKind({ source: input.row.source, messages: [] }),
      lastUserMessage: null,
      lastAssistantMessage: null,
    };
  }
}

async function readTranscriptForImport(input: {
  readonly homePath: string;
  readonly row: CodexThreadRow;
}): Promise<ParsedCodexTranscript> {
  const resolvedRolloutPath = resolveRolloutPath(input.homePath, input.row.rolloutPath);
  if (!resolvedRolloutPath) {
    throw toError("Transcript path is missing for this Codex session.");
  }
  if (path.extname(resolvedRolloutPath) !== ".jsonl") {
    throw toError(`Transcript file must be a .jsonl rollout, received ${resolvedRolloutPath}.`);
  }
  if (!(await exists(resolvedRolloutPath))) {
    throw toError(`Transcript file not found at ${resolvedRolloutPath}.`);
  }

  try {
    return parseCodexTranscript(await fs.readFile(resolvedRolloutPath, "utf8"));
  } catch (error) {
    if (error instanceof CodexTranscriptParseError) {
      throw toError(error.message);
    }
    throw toError(error instanceof Error ? error.message : "Unable to read transcript.");
  }
}

function toSummary(
  row: CodexThreadRow,
  summary: Awaited<ReturnType<typeof readTranscriptSummary>>,
  readModel: OrchestrationReadModel,
): CodexImportSessionSummary {
  const importedThreadId = toCanonicalThreadId(row.id);
  const alreadyImported = readModel.threads.some((thread) => thread.id === importedThreadId);

  return {
    sessionId: row.id,
    title: sanitizeTitle(row.title, row.id),
    cwd: row.cwd?.trim() ? row.cwd.trim() : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    model: summary.parsed?.model ?? null,
    kind: summary.kind,
    transcriptAvailable: summary.transcriptAvailable,
    transcriptError: summary.transcriptError,
    alreadyImported,
    importedThreadId: alreadyImported ? importedThreadId : null,
    lastUserMessage: summary.lastUserMessage,
    lastAssistantMessage: summary.lastAssistantMessage,
  };
}

function resolveProjectTitle(workspaceRoot: string): string {
  const basename = path.basename(workspaceRoot);
  return basename.trim().length > 0 ? basename : workspaceRoot;
}

function readBindingCwd(runtimePayload: unknown): string | null {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return null;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  return typeof rawCwd === "string" && rawCwd.trim().length > 0 ? rawCwd.trim() : null;
}

function isImportedCodexThread(threadId: ThreadId): boolean {
  return threadId.startsWith("codex-import-");
}

function isCodexManagedWorktreePath(cwd: string): boolean {
  return /[/\\]\.codex[/\\]worktrees[/\\][^/\\]+[/\\][^/\\]+$/.test(cwd);
}

const makeCodexImport = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const git = yield* GitCore;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestration = yield* OrchestrationEngineService;
  const providerSessionDirectory = yield* ProviderSessionDirectory;

  const resolveCanonicalWorkspace = (
    cwd: string,
  ): Effect.Effect<CanonicalWorkspace, CodexImportError> =>
    Effect.gen(function* () {
      const normalizedCwd = cwd.trim();
      const originalCwd = yield* Effect.tryPromise({
        try: () => fs.realpath(normalizedCwd),
        catch: (error) => toCodexImportError(error, "Unable to resolve the original cwd."),
      });
      const showTopLevel = yield* git
        .execute({
          operation: "CodexImport.resolveCanonicalWorkspace.showToplevel",
          cwd: originalCwd,
          args: ["rev-parse", "--path-format=absolute", "--show-toplevel"],
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.mapError((error) =>
            toCodexImportError(error, "Unable to inspect the imported git workspace."),
          ),
        );
      if (showTopLevel.code !== 0) {
        return {
          projectWorkspaceRoot: originalCwd,
          originalCwd,
          worktreePath: null,
        };
      }

      const gitCommonDirResult = yield* git
        .execute({
          operation: "CodexImport.resolveCanonicalWorkspace.gitCommonDir",
          cwd: originalCwd,
          args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          allowNonZeroExit: true,
        })
        .pipe(
          Effect.mapError((error) =>
            toCodexImportError(error, "Unable to inspect the imported git workspace."),
          ),
        );

      const topLevelPath = showTopLevel.stdout.trim();
      if (topLevelPath.length === 0 || gitCommonDirResult.code !== 0) {
        return {
          projectWorkspaceRoot: originalCwd,
          originalCwd,
          worktreePath: null,
        };
      }

      const gitCommonDir = gitCommonDirResult.stdout.trim();
      if (gitCommonDir.length === 0) {
        return {
          projectWorkspaceRoot: originalCwd,
          originalCwd,
          worktreePath: null,
        };
      }

      const [resolvedTopLevel, resolvedCommonDir] = yield* Effect.tryPromise({
        try: () => Promise.all([fs.realpath(topLevelPath), fs.realpath(gitCommonDir)]),
        catch: (error) => toCodexImportError(error, "Unable to resolve imported git paths."),
      });

      const projectWorkspaceRoot =
        path.basename(resolvedCommonDir) === ".git"
          ? path.dirname(resolvedCommonDir)
          : resolvedTopLevel;
      return {
        projectWorkspaceRoot,
        originalCwd,
        worktreePath: resolvedTopLevel === projectWorkspaceRoot ? null : resolvedTopLevel,
      };
    });

  const normalizeWorkspaceRoot = (workspaceRoot: string): Effect.Effect<string, never> =>
    Effect.tryPromise({
      try: () => fs.realpath(workspaceRoot),
      catch: () => path.resolve(workspaceRoot),
    }).pipe(Effect.orElseSucceed(() => path.resolve(workspaceRoot)));

  const findExistingProjectByWorkspaceRoot = (
    readModel: OrchestrationReadModel,
    workspaceRoot: string,
  ): Effect.Effect<OrchestrationReadModel["projects"][number] | null, never> =>
    Effect.gen(function* () {
      const normalizedWorkspaceRoot = yield* normalizeWorkspaceRoot(workspaceRoot);
      for (const project of readModel.projects) {
        if (project.deletedAt !== null) {
          continue;
        }
        const normalizedProjectRoot = yield* normalizeWorkspaceRoot(project.workspaceRoot);
        if (normalizedProjectRoot === normalizedWorkspaceRoot) {
          return project;
        }
      }
      return null;
    });

  const inferCanonicalWorkspaceFromReadModel = (
    readModel: OrchestrationReadModel,
    cwd: string,
  ): Effect.Effect<CanonicalWorkspace | null, never> =>
    Effect.sync(() => {
      if (!isCodexManagedWorktreePath(cwd)) {
        return null;
      }

      const repoName = path.basename(cwd);
      if (repoName.trim().length === 0) {
        return null;
      }

      const candidates: Array<OrchestrationReadModel["projects"][number]> = [];
      for (const project of readModel.projects) {
        if (project.deletedAt !== null) {
          continue;
        }
        if (isCodexManagedWorktreePath(project.workspaceRoot)) {
          continue;
        }
        if (path.basename(project.workspaceRoot) !== repoName) {
          continue;
        }
        candidates.push(project);
      }

      if (candidates.length !== 1) {
        return null;
      }

      const canonicalProject = candidates[0];
      if (!canonicalProject) {
        return null;
      }

      return {
        projectWorkspaceRoot: canonicalProject.workspaceRoot,
        originalCwd: cwd,
        // The imported worktree no longer exists, so avoid pinning the thread
        // to a dead path while still collapsing the duplicate project.
        worktreePath: null,
      } satisfies CanonicalWorkspace;
    });

  const ensureProjectForWorkspace = (
    readModel: OrchestrationReadModel,
    workspaceRoot: string,
  ): Effect.Effect<ProjectId, CodexImportError> =>
    Effect.gen(function* () {
      const existingProject = yield* findExistingProjectByWorkspaceRoot(readModel, workspaceRoot);
      if (existingProject) {
        return existingProject.id;
      }

      const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
      yield* orchestration
        .dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe(crypto.randomUUID()),
          projectId,
          title: resolveProjectTitle(workspaceRoot),
          workspaceRoot,
          createdAt: new Date().toISOString(),
        })
        .pipe(Effect.mapError((error) => toCodexImportError(error, "Unable to create project.")));
      return projectId;
    });

  const listImportedThreadBindings = (): Effect.Effect<
    ReadonlyArray<ImportedThreadRuntimeBinding>,
    CodexImportError
  > =>
    Effect.gen(function* () {
      const threadIds = yield* providerSessionDirectory
        .listThreadIds()
        .pipe(
          Effect.mapError((error) =>
            toCodexImportError(error, "Unable to list imported thread bindings."),
          ),
        );

      const bindings = yield* Effect.forEach(threadIds.filter(isImportedCodexThread), (threadId) =>
        providerSessionDirectory.getBinding(threadId).pipe(
          Effect.mapError((error) =>
            toCodexImportError(error, "Unable to inspect imported thread bindings."),
          ),
          Effect.map((binding) => {
            if (Option.isNone(binding)) {
              return null;
            }
            const cwd = readBindingCwd(binding.value.runtimePayload);
            if (!cwd) {
              return null;
            }
            return { threadId, cwd } satisfies ImportedThreadRuntimeBinding;
          }),
        ),
      );

      return bindings.filter(
        (binding): binding is ImportedThreadRuntimeBinding => binding !== null,
      );
    });

  const reconcileImportedGitProjects = (): Effect.Effect<void, CodexImportError> =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotQuery
        .getSnapshot()
        .pipe(Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")));
      const importedBindings = yield* listImportedThreadBindings();
      if (importedBindings.length === 0) {
        return;
      }

      const canonicalProjectIdByRoot = new Map<string, ProjectId>();
      const duplicateProjectTargets = new Map<ProjectId, ProjectId>();
      const sourceProjectIds = new Set<ProjectId>();
      let latestSnapshot = snapshot;

      for (const binding of importedBindings) {
        const thread = latestSnapshot.threads.find(
          (candidate) => candidate.id === binding.threadId && candidate.deletedAt === null,
        );
        if (!thread) {
          continue;
        }

        const canonicalWorkspace = yield* resolveCanonicalWorkspace(binding.cwd).pipe(
          Effect.catchTag("CodexImportError", () =>
            inferCanonicalWorkspaceFromReadModel(latestSnapshot, binding.cwd).pipe(
              Effect.map(
                (inferred) =>
                  inferred ??
                  ({
                    projectWorkspaceRoot: binding.cwd,
                    originalCwd: binding.cwd,
                    worktreePath: null,
                  } satisfies CanonicalWorkspace),
              ),
            ),
          ),
        );

        let targetProjectId = canonicalProjectIdByRoot.get(canonicalWorkspace.projectWorkspaceRoot);
        if (!targetProjectId) {
          targetProjectId = yield* ensureProjectForWorkspace(
            latestSnapshot,
            canonicalWorkspace.projectWorkspaceRoot,
          );
          canonicalProjectIdByRoot.set(canonicalWorkspace.projectWorkspaceRoot, targetProjectId);
          latestSnapshot = yield* snapshotQuery
            .getSnapshot()
            .pipe(
              Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")),
            );
        }

        const duplicateProject = yield* findExistingProjectByWorkspaceRoot(
          latestSnapshot,
          canonicalWorkspace.originalCwd,
        );
        if (duplicateProject && duplicateProject.id !== targetProjectId) {
          duplicateProjectTargets.set(duplicateProject.id, targetProjectId);
          sourceProjectIds.add(duplicateProject.id);
        }

        const needsProjectMove = thread.projectId !== targetProjectId;
        const needsWorktreeUpdate = thread.worktreePath !== canonicalWorkspace.worktreePath;
        if (!needsProjectMove && !needsWorktreeUpdate) {
          continue;
        }

        if (needsProjectMove) {
          duplicateProjectTargets.set(thread.projectId, targetProjectId);
        }
        sourceProjectIds.add(thread.projectId);
        yield* orchestration
          .dispatch({
            type: "thread.meta.update",
            commandId: CommandId.makeUnsafe(crypto.randomUUID()),
            threadId: thread.id,
            ...(needsProjectMove ? { projectId: targetProjectId } : {}),
            ...(needsWorktreeUpdate ? { worktreePath: canonicalWorkspace.worktreePath } : {}),
          })
          .pipe(
            Effect.mapError((error) =>
              toCodexImportError(error, "Unable to reconcile imported worktree projects."),
            ),
          );
        latestSnapshot = yield* snapshotQuery
          .getSnapshot()
          .pipe(Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")));
      }

      for (const [sourceProjectId, targetProjectId] of duplicateProjectTargets.entries()) {
        const threadsToMove = latestSnapshot.threads.filter(
          (thread) =>
            thread.projectId === sourceProjectId &&
            thread.deletedAt === null &&
            thread.id !== undefined,
        );
        for (const thread of threadsToMove) {
          yield* orchestration
            .dispatch({
              type: "thread.meta.update",
              commandId: CommandId.makeUnsafe(crypto.randomUUID()),
              threadId: thread.id,
              projectId: targetProjectId,
            })
            .pipe(
              Effect.mapError((error) =>
                toCodexImportError(
                  error,
                  "Unable to move duplicate-project threads onto the canonical project.",
                ),
              ),
            );
          sourceProjectIds.add(sourceProjectId);
          latestSnapshot = yield* snapshotQuery
            .getSnapshot()
            .pipe(
              Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")),
            );
        }
      }

      for (const projectId of sourceProjectIds) {
        const project = latestSnapshot.projects.find(
          (candidate) => candidate.id === projectId && candidate.deletedAt === null,
        );
        if (!project) {
          continue;
        }
        const hasLiveThreads = latestSnapshot.threads.some(
          (thread) => thread.projectId === projectId && thread.deletedAt === null,
        );
        if (hasLiveThreads) {
          continue;
        }

        yield* orchestration
          .dispatch({
            type: "project.delete",
            commandId: CommandId.makeUnsafe(crypto.randomUUID()),
            projectId,
          })
          .pipe(
            Effect.mapError((error) =>
              toCodexImportError(error, "Unable to clean up duplicate imported projects."),
            ),
          );
        latestSnapshot = yield* snapshotQuery
          .getSnapshot()
          .pipe(Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")));
      }
    });

  const listSessions: CodexImportShape["listSessions"] = (input) =>
    Effect.gen(function* () {
      yield* reconcileImportedGitProjects();
      const codexHome = yield* Effect.tryPromise({
        try: () => resolveCodexHome(input.homePath),
        catch: (error) => toCodexImportError(error, "Unable to resolve Codex home."),
      });
      const allRows = yield* Effect.try({
        try: () => readThreadRows(codexHome.databasePath),
        catch: (error) => toCodexImportError(error, "Unable to read Codex session index."),
      });
      const readModel = yield* snapshotQuery
        .getSnapshot()
        .pipe(Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")));

      const query = input.query?.trim().toLowerCase() ?? "";
      const tokens = query.split(/\s+/).filter((token) => token.length > 0);
      const nowMs = Date.now();
      const days = query.length > 0 ? undefined : (input.days ?? DEFAULT_RECENT_DAYS);
      const limit =
        query.length > 0
          ? (input.limit ?? DEFAULT_SEARCH_LIMIT)
          : (input.limit ?? DEFAULT_RECENT_LIMIT);

      const shortlisted = allRows
        .filter((row) => {
          if (days === undefined) {
            return true;
          }
          const updatedAtMs = Date.parse(row.updatedAt ?? row.createdAt ?? "");
          if (!Number.isFinite(updatedAtMs)) {
            return true;
          }
          return nowMs - updatedAtMs <= days * 24 * 60 * 60 * 1_000;
        })
        .map((row) => {
          const haystack =
            `${row.title ?? ""} ${row.firstUserMessage ?? ""} ${row.cwd ?? ""}`.toLowerCase();
          const score = query.length > 0 ? scoreTokens(haystack, tokens) : 0;
          return { row, score };
        })
        .filter((entry) => query.length === 0 || entry.score > 0)
        .toSorted((left, right) => {
          if (query.length > 0 && left.score !== right.score) {
            return right.score - left.score;
          }
          return (right.row.updatedAt ?? right.row.createdAt ?? "").localeCompare(
            left.row.updatedAt ?? left.row.createdAt ?? "",
          );
        })
        .slice(0, limit)
        .map((entry) => entry.row);

      const summaries = yield* Effect.tryPromise({
        try: () =>
          Promise.all(
            shortlisted.map(async (row) => {
              const transcriptSummary = await readTranscriptSummary({
                homePath: codexHome.homePath,
                row,
              });
              return toSummary(row, transcriptSummary, readModel);
            }),
          ),
        catch: (error) => toCodexImportError(error, "Unable to inspect transcripts."),
      });

      return summaries.filter((summary) =>
        isConcreteKind(input.kind) ? summary.kind === input.kind : true,
      );
    });

  const peekSession: CodexImportShape["peekSession"] = (input) =>
    Effect.gen(function* () {
      yield* reconcileImportedGitProjects();
      const codexHome = yield* Effect.tryPromise({
        try: () => resolveCodexHome(input.homePath),
        catch: (error) => toCodexImportError(error, "Unable to resolve Codex home."),
      });
      const row = yield* Effect.try({
        try: () => readThreadRowById(codexHome.databasePath, input.sessionId),
        catch: (error) => toCodexImportError(error, "Unable to read Codex session."),
      });
      if (!row) {
        return yield* toError(`Codex session '${input.sessionId}' was not found.`);
      }

      const readModel = yield* snapshotQuery
        .getSnapshot()
        .pipe(Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")));
      const importedThreadId = toCanonicalThreadId(row.id);
      const alreadyImported = readModel.threads.some((thread) => thread.id === importedThreadId);
      const resolvedRolloutPath = resolveRolloutPath(codexHome.homePath, row.rolloutPath);

      if (!resolvedRolloutPath) {
        return {
          sessionId: row.id,
          title: sanitizeTitle(row.title, row.id),
          cwd: row.cwd?.trim() ? row.cwd.trim() : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          model: null,
          runtimeMode: "full-access" as RuntimeMode,
          interactionMode: "default" as ProviderInteractionMode,
          kind: classifyCodexSessionKind({ source: row.source, messages: [] }),
          transcriptAvailable: false,
          transcriptError: "Transcript path is missing for this Codex session.",
          alreadyImported,
          importedThreadId: alreadyImported ? importedThreadId : null,
          messages: [],
        } satisfies CodexImportPeekSessionResult;
      }

      if (path.extname(resolvedRolloutPath) !== ".jsonl") {
        return {
          sessionId: row.id,
          title: sanitizeTitle(row.title, row.id),
          cwd: row.cwd?.trim() ? row.cwd.trim() : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          model: null,
          runtimeMode: "full-access" as RuntimeMode,
          interactionMode: "default" as ProviderInteractionMode,
          kind: classifyCodexSessionKind({ source: row.source, messages: [] }),
          transcriptAvailable: false,
          transcriptError: `Transcript file must be a .jsonl rollout, received ${resolvedRolloutPath}.`,
          alreadyImported,
          importedThreadId: alreadyImported ? importedThreadId : null,
          messages: [],
        } satisfies CodexImportPeekSessionResult;
      }

      const preview = yield* Effect.tryPromise({
        try: async () => {
          try {
            const transcript = parseCodexTranscript(
              await fs.readFile(resolvedRolloutPath, "utf8"),
              {
                messageWindow: input.messageCount ?? DEFAULT_PEEK_MESSAGE_COUNT,
              },
            );
            const kind = classifyCodexSessionKind({
              source: row.source,
              messages: transcript.messages,
            });
            return {
              model: transcript.model,
              runtimeMode: transcript.runtimeMode,
              interactionMode: transcript.interactionMode,
              kind,
              transcriptAvailable: true,
              transcriptError: null,
              messages: transcript.messages.map((message) => ({
                role: message.role,
                text: message.text,
                createdAt: message.createdAt,
              })),
            } as const;
          } catch (error) {
            const detail =
              error instanceof CodexTranscriptParseError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : "Unable to parse transcript.";
            return {
              model: null,
              runtimeMode: "full-access" as RuntimeMode,
              interactionMode: "default" as ProviderInteractionMode,
              kind: classifyCodexSessionKind({ source: row.source, messages: [] }),
              transcriptAvailable: false,
              transcriptError: detail,
              messages: [],
            } as const;
          }
        },
        catch: (error) => toCodexImportError(error, "Unable to preview transcript."),
      });

      return {
        sessionId: row.id,
        title: sanitizeTitle(row.title, row.id),
        cwd: row.cwd?.trim() ? row.cwd.trim() : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        model: preview.model,
        runtimeMode: preview.runtimeMode,
        interactionMode: preview.interactionMode,
        kind: preview.kind,
        transcriptAvailable: preview.transcriptAvailable,
        transcriptError: preview.transcriptError,
        alreadyImported,
        importedThreadId: alreadyImported ? importedThreadId : null,
        messages: preview.messages,
      } satisfies CodexImportPeekSessionResult;
    });

  const importSessions: CodexImportShape["importSessions"] = (input) =>
    Effect.gen(function* () {
      yield* reconcileImportedGitProjects();
      const codexHome = yield* Effect.tryPromise({
        try: () => resolveCodexHome(input.homePath),
        catch: (error) => toCodexImportError(error, "Unable to resolve Codex home."),
      });
      const results: Array<CodexImportImportSessionsResult["results"][number]> = [];

      for (const sessionId of input.sessionIds) {
        const sessionExit = yield* Effect.exit(
          Effect.gen(function* () {
            const row = yield* Effect.try({
              try: () => readThreadRowById(codexHome.databasePath, sessionId),
              catch: (error) => toCodexImportError(error, "Unable to read Codex session."),
            });
            if (!row) {
              return yield* toError(`Codex session '${sessionId}' was not found.`);
            }

            const transcript = yield* Effect.tryPromise({
              try: () =>
                readTranscriptForImport({
                  homePath: codexHome.homePath,
                  row,
                }),
              catch: (error) => toCodexImportError(error, "Unable to load transcript."),
            });
            const kind = classifyCodexSessionKind({
              source: row.source,
              messages: transcript.messages,
            });

            const threadId = toCanonicalThreadId(row.id);
            const latestSnapshot = yield* snapshotQuery
              .getSnapshot()
              .pipe(
                Effect.mapError((error) => toCodexImportError(error, "Unable to read projects.")),
              );
            if (latestSnapshot.threads.some((thread) => thread.id === threadId)) {
              return {
                sessionId: row.id,
                status: "skipped-existing" as const,
                threadId,
                projectId:
                  latestSnapshot.threads.find((thread) => thread.id === threadId)?.projectId ??
                  null,
                error: null,
              };
            }

            const normalizedCwd = row.cwd?.trim() ? row.cwd.trim() : null;
            let canonicalWorkspace: CanonicalWorkspace | null = null;
            if (normalizedCwd) {
              const cwdExists = yield* Effect.tryPromise({
                try: () => statIsDirectory(normalizedCwd),
                catch: (error) => toCodexImportError(error, "Unable to inspect the original cwd."),
              });
              if (cwdExists) {
                canonicalWorkspace = yield* resolveCanonicalWorkspace(normalizedCwd);
              }
            }
            let projectId: ProjectId;

            if (canonicalWorkspace) {
              projectId = yield* ensureProjectForWorkspace(
                latestSnapshot,
                canonicalWorkspace.projectWorkspaceRoot,
              );
            } else {
              const fallbackWorkspaceRoot = yield* normalizeWorkspaceRoot(serverConfig.cwd);
              const existingFallbackProject = yield* findExistingProjectByWorkspaceRoot(
                latestSnapshot,
                fallbackWorkspaceRoot,
              );
              if (existingFallbackProject?.id === FALLBACK_PROJECT_ID) {
                projectId = existingFallbackProject.id;
              } else if (
                latestSnapshot.projects.some((project) => project.id === FALLBACK_PROJECT_ID)
              ) {
                projectId = FALLBACK_PROJECT_ID;
              } else {
                projectId = FALLBACK_PROJECT_ID;
                yield* orchestration
                  .dispatch({
                    type: "project.create",
                    commandId: CommandId.makeUnsafe(crypto.randomUUID()),
                    projectId,
                    title: FALLBACK_PROJECT_TITLE,
                    workspaceRoot: fallbackWorkspaceRoot,
                    createdAt: new Date().toISOString(),
                  })
                  .pipe(
                    Effect.mapError((error) =>
                      toCodexImportError(error, "Unable to create fallback project."),
                    ),
                  );
              }
            }

            const importedAt = new Date().toISOString();
            const model = transcript.model ?? DEFAULT_MODEL_BY_PROVIDER.codex;
            const command: ThreadImportCommand = {
              type: "thread.import",
              commandId: CommandId.makeUnsafe(crypto.randomUUID()),
              threadId,
              projectId,
              title: sanitizeTitle(row.title, row.id),
              model,
              runtimeMode: transcript.runtimeMode,
              interactionMode: transcript.interactionMode,
              branch: null,
              worktreePath: canonicalWorkspace?.worktreePath ?? null,
              createdAt: importedAt,
              messages: transcript.messages.map((message, index) => ({
                messageId: toMessageId(row.id, index),
                role: message.role,
                text: message.text,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
              })),
              source: {
                provider: "codex",
                sessionId: row.id,
                kind,
                originalCwd: normalizedCwd,
                sourceCreatedAt: row.createdAt,
                sourceUpdatedAt: row.updatedAt,
              },
            };

            yield* orchestration
              .dispatch(command)
              .pipe(
                Effect.mapError((error) => toCodexImportError(error, "Unable to import thread.")),
              );
            yield* providerSessionDirectory
              .upsert({
                threadId,
                provider: "codex",
                status: "stopped",
                runtimeMode: transcript.runtimeMode,
                resumeCursor: { threadId: row.id },
                runtimePayload: {
                  cwd: normalizedCwd,
                  model,
                  ...(codexHome.isDefaultHomePath
                    ? {}
                    : {
                        providerOptions: {
                          codex: {
                            homePath: codexHome.homePath,
                          },
                        },
                      }),
                  importSource: {
                    provider: "codex",
                    sessionId: row.id,
                    kind,
                    originalCwd: normalizedCwd,
                    sourceCreatedAt: row.createdAt,
                    sourceUpdatedAt: row.updatedAt,
                    importedAt,
                  },
                },
              })
              .pipe(
                Effect.mapError((error) =>
                  toCodexImportError(error, "Unable to persist Codex resume binding."),
                ),
              );

            return {
              sessionId: row.id,
              status: "imported" as const,
              threadId,
              projectId,
              error: null,
            };
          }),
        );

        results.push(
          sessionExit._tag === "Success"
            ? sessionExit.value
            : {
                sessionId,
                status: "failed",
                threadId: null,
                projectId: null,
                error: toCodexImportError(sessionExit.cause, "Import failed.").message,
              },
        );
      }

      return { results } satisfies CodexImportImportSessionsResult;
    });

  return {
    listSessions,
    peekSession,
    importSessions,
  } satisfies CodexImportShape;
});

export const CodexImportLive = Layer.effect(CodexImport, makeCodexImport);
