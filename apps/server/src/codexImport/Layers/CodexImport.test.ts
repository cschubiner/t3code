import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "../../serverLayers.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { CodexImport } from "../Services/CodexImport.ts";

const tempPaths: string[] = [];

function makeTempDir(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempPaths.push(directory);
  return directory;
}

function isoOffset(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function toEpochSeconds(timestamp: string): number {
  return Math.floor(Date.parse(timestamp) / 1_000);
}

function fromEpochSeconds(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString();
}

function buildTranscript(
  messages: ReadonlyArray<{ role: string; text: string; timestamp: string }>,
) {
  return [
    JSON.stringify({
      type: "turn_context",
      payload: {
        model: "gpt-5-codex",
        sandbox_policy: { type: "danger-full-access" },
        collaboration_mode: { mode: "default" },
      },
    }),
    ...messages.map((message) =>
      JSON.stringify({
        timestamp: message.timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: message.role,
          content: [
            {
              type: message.role === "user" ? "input_text" : "output_text",
              text: message.text,
            },
          ],
        },
      }),
    ),
  ].join("\n");
}

interface FixtureSessionInput {
  readonly sessionId: string;
  readonly title: string;
  readonly cwd: string | null;
  readonly source?: string;
  readonly firstUserMessage?: string | null;
  readonly updatedAt?: string | number;
  readonly createdAt?: string | number;
  readonly transcript?: string;
}

function createCodexHomeFixture(sessions: ReadonlyArray<FixtureSessionInput>): {
  readonly homePath: string;
} {
  const homePath = makeTempDir("t3code-codex-home-");
  const database = new DatabaseSync(path.join(homePath, "state_5.sqlite"));

  try {
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT,
        cwd TEXT,
        updated_at INTEGER,
        created_at INTEGER,
        source TEXT,
        rollout_path TEXT,
        first_user_message TEXT,
        archived INTEGER
      )
    `);

    const insert = database.prepare(`
      INSERT INTO threads (
        id,
        title,
        cwd,
        updated_at,
        created_at,
        source,
        rollout_path,
        first_user_message,
        archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const session of sessions) {
      const rolloutPath = path.join(homePath, `${session.sessionId}.jsonl`);
      fs.writeFileSync(rolloutPath, session.transcript ?? buildTranscript([]), "utf8");
      insert.run(
        session.sessionId,
        session.title,
        session.cwd,
        session.updatedAt ?? isoOffset(1),
        session.createdAt ?? isoOffset(2),
        session.source ?? "interactive",
        rolloutPath,
        session.firstUserMessage ?? null,
        0,
      );
    }
  } finally {
    database.close();
  }

  return { homePath };
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  execFileSync("git", [...args], {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T3 Code",
      GIT_AUTHOR_EMAIL: "t3code@example.com",
      GIT_COMMITTER_NAME: "T3 Code",
      GIT_COMMITTER_EMAIL: "t3code@example.com",
    },
  });
}

function createGitWorktreeFixture(prefix: string): {
  readonly repoRoot: string;
  readonly worktreePath: string;
} {
  const repoRoot = makeTempDir(`${prefix}-repo-`);
  const worktreePath = makeTempDir(`${prefix}-worktree-`);
  fs.rmSync(worktreePath, { recursive: true, force: true });

  runGit(repoRoot, ["init", "--initial-branch=main"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "root\n", "utf8");
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "Initial commit"]);
  runGit(repoRoot, ["worktree", "add", worktreePath, "-b", "feature/imported-worktree"]);

  return { repoRoot, worktreePath };
}

function canonicalPath(targetPath: string): string {
  return fs.realpathSync.native(targetPath);
}

async function createCodexImportSystem(serverCwd = makeTempDir("t3code-server-cwd-")) {
  const stateDir = makeTempDir("t3code-state-");
  const persistenceLayer = SqlitePersistenceMemory;
  const providerLayer = makeServerProviderLayer();
  const infrastructureLayer = providerLayer.pipe(Layer.provideMerge(persistenceLayer));
  const runtimeLayer = Layer.merge(
    makeServerRuntimeServicesLayer().pipe(Layer.provide(infrastructureLayer)),
    infrastructureLayer,
  );
  const fullLayer = Layer.empty.pipe(
    Layer.provideMerge(runtimeLayer),
    Layer.provideMerge(ServerConfig.layerTest(serverCwd, stateDir)),
    Layer.provideMerge(AnalyticsService.layerTest),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(fullLayer);

  return {
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      runtime.runPromise(effect as Effect.Effect<A, E, never>),
    dispose: () => runtime.dispose(),
    serverCwd,
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  attempts = 50,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

afterEach(() => {
  while (tempPaths.length > 0) {
    const target = tempPaths.pop();
    if (target) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});

describe("CodexImportLive", () => {
  it("lists sessions with helper-script classification and search over title, prompt, and cwd", async () => {
    const directCwd = makeTempDir("title-only-project-");
    const childCwd = makeTempDir("child-project-");
    const orchestratorCwd = makeTempDir("cwd-only-match-project-");
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "direct-session",
        title: "title-only-match",
        cwd: directCwd,
        firstUserMessage: "ordinary prompt",
        transcript: buildTranscript([
          { role: "user", text: "hello", timestamp: isoOffset(3) },
          { role: "assistant", text: "hi", timestamp: isoOffset(2) },
        ]),
      },
      {
        sessionId: "child-session",
        title: "subagent child",
        cwd: childCwd,
        source: "thread_spawn",
        firstUserMessage: "prompt-only-match",
        transcript: buildTranscript([
          { role: "user", text: "delegate", timestamp: isoOffset(4) },
          { role: "assistant", text: "done", timestamp: isoOffset(3) },
        ]),
      },
      {
        sessionId: "orchestrator-session",
        title: "orchestrator",
        cwd: orchestratorCwd,
        firstUserMessage: "delegate work",
        transcript: buildTranscript([
          {
            role: "user",
            text: "subagent_notification: spawned helper",
            timestamp: isoOffset(5),
          },
          { role: "assistant", text: "ack", timestamp: isoOffset(4) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      const kinds = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({
            homePath,
            kind: "all",
            days: 30,
            limit: 50,
          });
        }),
      );

      expect(Object.fromEntries(kinds.map((session) => [session.sessionId, session.kind]))).toEqual(
        {
          "child-session": "subagent-child",
          "direct-session": "direct",
          "orchestrator-session": "orchestrator",
        },
      );

      const titleSearch = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({
            homePath,
            kind: "all",
            query: "title-only-match",
            limit: 100,
          });
        }),
      );
      expect(titleSearch.map((session) => session.sessionId)).toEqual(["direct-session"]);

      const promptSearch = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({
            homePath,
            kind: "all",
            query: "prompt-only-match",
            limit: 100,
          });
        }),
      );
      expect(promptSearch.map((session) => session.sessionId)).toEqual(["child-session"]);

      const cwdSearch = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({
            homePath,
            kind: "all",
            query: "cwd-only-match",
            limit: 100,
          });
        }),
      );
      expect(cwdSearch.map((session) => session.sessionId)).toEqual(["orchestrator-session"]);
    } finally {
      await system.dispose();
    }
  });

  it("normalizes integer Codex timestamps before recency filtering and sorting", async () => {
    const newestUpdatedAt = toEpochSeconds(isoOffset(5));
    const olderUpdatedAt = toEpochSeconds(isoOffset(15));
    const staleUpdatedAt = toEpochSeconds(isoOffset(60 * 24 * 45));
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "newest-session",
        title: "Newest session",
        cwd: makeTempDir("newest-project-"),
        updatedAt: newestUpdatedAt,
        createdAt: newestUpdatedAt - 60,
      },
      {
        sessionId: "older-session",
        title: "Older session",
        cwd: makeTempDir("older-project-"),
        updatedAt: olderUpdatedAt,
        createdAt: olderUpdatedAt - 60,
      },
      {
        sessionId: "stale-session",
        title: "Stale session",
        cwd: makeTempDir("stale-project-"),
        updatedAt: staleUpdatedAt,
        createdAt: staleUpdatedAt - 60,
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      const sessions = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({
            homePath,
            kind: "all",
            days: 30,
            limit: 50,
          });
        }),
      );

      expect(sessions.map((session) => session.sessionId)).toEqual([
        "newest-session",
        "older-session",
      ]);
      expect(sessions[0]).toMatchObject({
        sessionId: "newest-session",
        updatedAt: fromEpochSeconds(newestUpdatedAt),
        createdAt: fromEpochSeconds(newestUpdatedAt - 60),
      });
      expect(sessions[1]).toMatchObject({
        sessionId: "older-session",
        updatedAt: fromEpochSeconds(olderUpdatedAt),
        createdAt: fromEpochSeconds(olderUpdatedAt - 60),
      });
    } finally {
      await system.dispose();
    }
  });

  it("peeks only importable text messages in transcript order", async () => {
    const workspaceRoot = makeTempDir("peek-project-");
    const transcript = [
      JSON.stringify({
        type: "turn_context",
        payload: {
          model: "gpt-5-codex",
          sandbox_policy: { type: "danger-full-access" },
          collaboration_mode: { mode: "default" },
        },
      }),
      JSON.stringify({
        timestamp: isoOffset(4),
        type: "response_item",
        payload: {
          type: "message",
          role: "system",
          content: [{ type: "text", text: "system prompt" }],
        },
      }),
      JSON.stringify({
        timestamp: isoOffset(3),
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "hello" },
            { type: "input_image", mime_type: "image/png", data: "..." },
          ],
        },
      }),
      JSON.stringify({
        timestamp: isoOffset(2),
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [{ type: "text", text: "skip me" }],
        },
      }),
      JSON.stringify({
        timestamp: isoOffset(2),
        type: "response_item",
        payload: {
          type: "reasoning",
          text: "also skip me",
        },
      }),
      JSON.stringify({
        timestamp: isoOffset(1),
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello back" }],
        },
      }),
    ].join("\n");
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "peek-session",
        title: "Peek session",
        cwd: workspaceRoot,
        firstUserMessage: "hello",
        transcript,
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      const preview = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.peekSession({
            homePath,
            sessionId: "peek-session",
            messageCount: 10,
          });
        }),
      );

      expect(preview.messages).toEqual([
        expect.objectContaining({ role: "system", text: "system prompt" }),
        expect.objectContaining({ role: "user", text: "hello" }),
        expect.objectContaining({ role: "assistant", text: "hello back" }),
      ]);
    } finally {
      await system.dispose();
    }
  });

  it("imports into an existing cwd-matched project, seeds a dormant binding, and skips re-imports", async () => {
    const workspaceRoot = makeTempDir("existing-project-");
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "resume-session",
        title: "Resume me",
        cwd: workspaceRoot,
        firstUserMessage: "import me",
        transcript: buildTranscript([
          { role: "user", text: "import me", timestamp: isoOffset(3) },
          { role: "assistant", text: "imported", timestamp: isoOffset(2) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-existing"),
            projectId: ProjectId.makeUnsafe("existing-project"),
            title: "Existing project",
            workspaceRoot,
            createdAt: isoOffset(1),
          });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        return snapshot.projects.some(
          (project) => project.id === ProjectId.makeUnsafe("existing-project"),
        );
      }, "Expected existing project to be projected before import.");

      const imported = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;

          return yield* codexImport.importSessions({
            homePath,
            sessionIds: ["resume-session"],
          });
        }),
      );

      expect(imported.results).toEqual([
        {
          sessionId: "resume-session",
          status: "imported",
          threadId: ThreadId.makeUnsafe("codex-import-resume-session"),
          projectId: ProjectId.makeUnsafe("existing-project"),
          error: null,
        },
      ]);

      const snapshot = await system.run(
        Effect.gen(function* () {
          const snapshots = yield* ProjectionSnapshotQuery;
          return yield* snapshots.getSnapshot();
        }),
      );
      const importedThread = snapshot.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("codex-import-resume-session"),
      );
      expect(importedThread?.projectId).toBe(ProjectId.makeUnsafe("existing-project"));
      expect(importedThread?.messages.map((message) => message.text)).toEqual([
        "import me",
        "imported",
      ]);

      const binding = await system.run(
        Effect.gen(function* () {
          const directory = yield* ProviderSessionDirectory;
          return yield* directory.getBinding(ThreadId.makeUnsafe("codex-import-resume-session"));
        }),
      );
      expect(Option.isSome(binding)).toBe(true);
      if (Option.isSome(binding)) {
        expect(binding.value.status).toBe("stopped");
        expect(binding.value.resumeCursor).toEqual({ threadId: "resume-session" });
        expect(binding.value.runtimePayload).toMatchObject({
          cwd: workspaceRoot,
          model: "gpt-5-codex",
          providerOptions: {
            codex: {
              homePath,
            },
          },
        });
      }

      const reimported = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.importSessions({
            homePath,
            sessionIds: ["resume-session"],
          });
        }),
      );
      expect(reimported.results[0]).toMatchObject({
        sessionId: "resume-session",
        status: "skipped-existing",
        threadId: ThreadId.makeUnsafe("codex-import-resume-session"),
      });
    } finally {
      await system.dispose();
    }
  });

  it("imports a git worktree session into the repo project and preserves the worktree path", async () => {
    const { repoRoot, worktreePath } = createGitWorktreeFixture("codex-import-worktree");
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "worktree-session",
        title: "Worktree import",
        cwd: worktreePath,
        firstUserMessage: "import from worktree",
        transcript: buildTranscript([
          { role: "user", text: "import from worktree", timestamp: isoOffset(3) },
          { role: "assistant", text: "done", timestamp: isoOffset(2) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-root"),
            projectId: ProjectId.makeUnsafe("root-project"),
            title: "Canal",
            workspaceRoot: repoRoot,
            createdAt: isoOffset(1),
          });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        return snapshot.projects.some(
          (project) => project.id === ProjectId.makeUnsafe("root-project"),
        );
      }, "Expected root project to be projected before worktree import.");

      const imported = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;

          return yield* codexImport.importSessions({
            homePath,
            sessionIds: ["worktree-session"],
          });
        }),
      );

      expect(imported.results).toEqual([
        {
          sessionId: "worktree-session",
          status: "imported",
          threadId: ThreadId.makeUnsafe("codex-import-worktree-session"),
          projectId: ProjectId.makeUnsafe("root-project"),
          error: null,
        },
      ]);

      const snapshot = await system.run(
        Effect.gen(function* () {
          const snapshots = yield* ProjectionSnapshotQuery;
          return yield* snapshots.getSnapshot();
        }),
      );

      expect(snapshot.projects.filter((project) => project.deletedAt === null)).toHaveLength(1);
      const importedThread = snapshot.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("codex-import-worktree-session"),
      );
      expect(importedThread?.projectId).toBe(ProjectId.makeUnsafe("root-project"));
      expect(importedThread?.worktreePath).toBe(canonicalPath(worktreePath));
    } finally {
      await system.dispose();
    }
  });

  it("reconciles previously imported duplicate worktree projects into the repo project", async () => {
    const { repoRoot, worktreePath } = createGitWorktreeFixture("codex-import-reconcile");
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "existing-duplicate-session",
        title: "Existing duplicate",
        cwd: worktreePath,
        firstUserMessage: "existing duplicate",
        transcript: buildTranscript([
          { role: "user", text: "existing duplicate", timestamp: isoOffset(3) },
          { role: "assistant", text: "done", timestamp: isoOffset(2) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const directory = yield* ProviderSessionDirectory;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-root-existing"),
            projectId: ProjectId.makeUnsafe("root-project-existing"),
            title: "Canal",
            workspaceRoot: repoRoot,
            createdAt: isoOffset(5),
          });
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-duplicate"),
            projectId: ProjectId.makeUnsafe("duplicate-project"),
            title: "canal",
            workspaceRoot: worktreePath,
            createdAt: isoOffset(4),
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-duplicate"),
            threadId: ThreadId.makeUnsafe("codex-import-existing-duplicate-session"),
            projectId: ProjectId.makeUnsafe("duplicate-project"),
            title: "Existing duplicate",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: isoOffset(3),
          });
          yield* directory.upsert({
            threadId: ThreadId.makeUnsafe("codex-import-existing-duplicate-session"),
            provider: "codex",
            status: "stopped",
            resumeCursor: { threadId: "existing-duplicate-session" },
            runtimePayload: {
              cwd: worktreePath,
              model: "gpt-5-codex",
              providerOptions: {
                codex: {
                  homePath,
                },
              },
            },
          });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        return (
          snapshot.projects.some(
            (project) => project.id === ProjectId.makeUnsafe("root-project-existing"),
          ) &&
          snapshot.projects.some(
            (project) => project.id === ProjectId.makeUnsafe("duplicate-project"),
          ) &&
          snapshot.threads.some(
            (thread) =>
              thread.id === ThreadId.makeUnsafe("codex-import-existing-duplicate-session"),
          )
        );
      }, "Expected duplicate import fixtures to be projected before reconciliation.");

      await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({ homePath, limit: 10, kind: "all" });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        const thread = snapshot.threads.find(
          (candidate) =>
            candidate.id === ThreadId.makeUnsafe("codex-import-existing-duplicate-session"),
        );
        const project = snapshot.projects.find(
          (candidate) => candidate.id === ProjectId.makeUnsafe("duplicate-project"),
        );
        return (
          thread?.projectId === ProjectId.makeUnsafe("root-project-existing") &&
          thread.worktreePath === canonicalPath(worktreePath) &&
          project?.deletedAt !== null
        );
      }, "Expected duplicate worktree import to be reconciled.");

      const snapshot = await system.run(
        Effect.gen(function* () {
          const snapshots = yield* ProjectionSnapshotQuery;
          return yield* snapshots.getSnapshot();
        }),
      );

      const reconciledThread = snapshot.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("codex-import-existing-duplicate-session"),
      );
      expect(reconciledThread?.projectId).toBe(ProjectId.makeUnsafe("root-project-existing"));
      expect(reconciledThread?.worktreePath).toBe(canonicalPath(worktreePath));

      const duplicateProject = snapshot.projects.find(
        (project) => project.id === ProjectId.makeUnsafe("duplicate-project"),
      );
      expect(duplicateProject?.deletedAt).not.toBeNull();
    } finally {
      await system.dispose();
    }
  });

  it("reconciles all live threads off a duplicate imported worktree project", async () => {
    const repoRoot = makeTempDir("canal-root-all-threads-");
    const missingWorktreePath = path.join(
      os.homedir(),
      ".codex",
      "worktrees",
      "feedface",
      path.basename(repoRoot),
    );
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "duplicate-project-anchor",
        title: "Imported duplicate anchor",
        cwd: missingWorktreePath,
        firstUserMessage: "anchor",
        transcript: buildTranscript([
          { role: "user", text: "anchor", timestamp: isoOffset(3) },
          { role: "assistant", text: "done", timestamp: isoOffset(2) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const directory = yield* ProviderSessionDirectory;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-root-all-threads"),
            projectId: ProjectId.makeUnsafe("root-project-all-threads"),
            title: path.basename(repoRoot),
            workspaceRoot: repoRoot,
            createdAt: isoOffset(6),
          });
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-duplicate-all-threads"),
            projectId: ProjectId.makeUnsafe("duplicate-project-all-threads"),
            title: path.basename(repoRoot),
            workspaceRoot: missingWorktreePath,
            createdAt: isoOffset(5),
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-import-anchor"),
            threadId: ThreadId.makeUnsafe("codex-import-duplicate-project-anchor"),
            projectId: ProjectId.makeUnsafe("duplicate-project-all-threads"),
            title: "Imported duplicate anchor",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: isoOffset(4),
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-manual-duplicate"),
            threadId: ThreadId.makeUnsafe("manual-thread-in-duplicate-project"),
            projectId: ProjectId.makeUnsafe("duplicate-project-all-threads"),
            title: "Manual thread",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: "/tmp/t3code-worktree",
            createdAt: isoOffset(3),
          });
          yield* directory.upsert({
            threadId: ThreadId.makeUnsafe("codex-import-duplicate-project-anchor"),
            provider: "codex",
            status: "stopped",
            resumeCursor: { threadId: "duplicate-project-anchor" },
            runtimePayload: {
              cwd: missingWorktreePath,
              model: "gpt-5-codex",
              providerOptions: {
                codex: {
                  homePath,
                },
              },
            },
          });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        return (
          snapshot.threads.some(
            (thread) => thread.id === ThreadId.makeUnsafe("manual-thread-in-duplicate-project"),
          ) &&
          snapshot.projects.some(
            (project) => project.id === ProjectId.makeUnsafe("duplicate-project-all-threads"),
          )
        );
      }, "Expected duplicate-project fixtures to be projected before full reconciliation.");

      await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({ homePath, limit: 10, kind: "all" });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        const importedThread = snapshot.threads.find(
          (candidate) =>
            candidate.id === ThreadId.makeUnsafe("codex-import-duplicate-project-anchor"),
        );
        const manualThread = snapshot.threads.find(
          (candidate) => candidate.id === ThreadId.makeUnsafe("manual-thread-in-duplicate-project"),
        );
        const duplicateProject = snapshot.projects.find(
          (candidate) => candidate.id === ProjectId.makeUnsafe("duplicate-project-all-threads"),
        );
        return (
          importedThread?.projectId === ProjectId.makeUnsafe("root-project-all-threads") &&
          manualThread?.projectId === ProjectId.makeUnsafe("root-project-all-threads") &&
          manualThread.worktreePath === "/tmp/t3code-worktree" &&
          duplicateProject?.deletedAt !== null
        );
      }, "Expected all duplicate-project threads to move to the canonical project.");
    } finally {
      await system.dispose();
    }
  });

  it("reconciles duplicate imported projects even after the import anchor thread already moved", async () => {
    const repoRoot = makeTempDir("canal-root-post-anchor-");
    const missingWorktreePath = path.join(
      os.homedir(),
      ".codex",
      "worktrees",
      "c0ffee",
      path.basename(repoRoot),
    );
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "already-moved-anchor",
        title: "Already moved anchor",
        cwd: missingWorktreePath,
        firstUserMessage: "anchor",
        transcript: buildTranscript([
          { role: "user", text: "anchor", timestamp: isoOffset(3) },
          { role: "assistant", text: "done", timestamp: isoOffset(2) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const directory = yield* ProviderSessionDirectory;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-root-post-anchor"),
            projectId: ProjectId.makeUnsafe("root-project-post-anchor"),
            title: path.basename(repoRoot),
            workspaceRoot: repoRoot,
            createdAt: isoOffset(6),
          });
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-duplicate-post-anchor"),
            projectId: ProjectId.makeUnsafe("duplicate-project-post-anchor"),
            title: path.basename(repoRoot),
            workspaceRoot: missingWorktreePath,
            createdAt: isoOffset(5),
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-import-post-anchor"),
            threadId: ThreadId.makeUnsafe("codex-import-already-moved-anchor"),
            projectId: ProjectId.makeUnsafe("root-project-post-anchor"),
            title: "Already moved anchor",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: missingWorktreePath,
            createdAt: isoOffset(4),
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-manual-post-anchor"),
            threadId: ThreadId.makeUnsafe("manual-thread-post-anchor"),
            projectId: ProjectId.makeUnsafe("duplicate-project-post-anchor"),
            title: "Manual duplicate thread",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: "/tmp/post-anchor-worktree",
            createdAt: isoOffset(3),
          });
          yield* directory.upsert({
            threadId: ThreadId.makeUnsafe("codex-import-already-moved-anchor"),
            provider: "codex",
            status: "stopped",
            resumeCursor: { threadId: "already-moved-anchor" },
            runtimePayload: {
              cwd: missingWorktreePath,
              model: "gpt-5-codex",
              providerOptions: {
                codex: {
                  homePath,
                },
              },
            },
          });
        }),
      );

      await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({ homePath, limit: 10, kind: "all" });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        const manualThread = snapshot.threads.find(
          (candidate) => candidate.id === ThreadId.makeUnsafe("manual-thread-post-anchor"),
        );
        const duplicateProject = snapshot.projects.find(
          (candidate) => candidate.id === ProjectId.makeUnsafe("duplicate-project-post-anchor"),
        );
        return (
          manualThread?.projectId === ProjectId.makeUnsafe("root-project-post-anchor") &&
          manualThread.worktreePath === "/tmp/post-anchor-worktree" &&
          duplicateProject?.deletedAt !== null
        );
      }, "Expected stale duplicate project to collapse after its import anchor already moved.");
    } finally {
      await system.dispose();
    }
  });

  it("reconciles missing Codex-managed worktree projects into the canonical repo project", async () => {
    const repoRoot = makeTempDir("canal-root-");
    const missingWorktreePath = path.join(
      os.homedir(),
      ".codex",
      "worktrees",
      "deadbeef",
      path.basename(repoRoot),
    );
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "missing-worktree-session",
        title: "Missing worktree import",
        cwd: missingWorktreePath,
        firstUserMessage: "missing worktree",
        transcript: buildTranscript([
          { role: "user", text: "missing worktree", timestamp: isoOffset(3) },
          { role: "assistant", text: "done", timestamp: isoOffset(2) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem();

    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const directory = yield* ProviderSessionDirectory;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-root-missing"),
            projectId: ProjectId.makeUnsafe("root-project-missing"),
            title: path.basename(repoRoot),
            workspaceRoot: repoRoot,
            createdAt: isoOffset(5),
          });
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-duplicate-missing"),
            projectId: ProjectId.makeUnsafe("duplicate-project-missing"),
            title: path.basename(repoRoot),
            workspaceRoot: missingWorktreePath,
            createdAt: isoOffset(4),
          });
          yield* engine.dispatch({
            type: "thread.create",
            commandId: CommandId.makeUnsafe("cmd-thread-duplicate-missing"),
            threadId: ThreadId.makeUnsafe("codex-import-missing-worktree-session"),
            projectId: ProjectId.makeUnsafe("duplicate-project-missing"),
            title: "Missing worktree import",
            model: "gpt-5-codex",
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: isoOffset(3),
          });
          yield* directory.upsert({
            threadId: ThreadId.makeUnsafe("codex-import-missing-worktree-session"),
            provider: "codex",
            status: "stopped",
            resumeCursor: { threadId: "missing-worktree-session" },
            runtimePayload: {
              cwd: missingWorktreePath,
              model: "gpt-5-codex",
              providerOptions: {
                codex: {
                  homePath,
                },
              },
            },
          });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        return snapshot.projects.some(
          (project) => project.id === ProjectId.makeUnsafe("duplicate-project-missing"),
        );
      }, "Expected missing-worktree fixtures to be projected before reconciliation.");

      await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.listSessions({ homePath, limit: 10, kind: "all" });
        }),
      );
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        const thread = snapshot.threads.find(
          (candidate) =>
            candidate.id === ThreadId.makeUnsafe("codex-import-missing-worktree-session"),
        );
        const project = snapshot.projects.find(
          (candidate) => candidate.id === ProjectId.makeUnsafe("duplicate-project-missing"),
        );
        return (
          thread?.projectId === ProjectId.makeUnsafe("root-project-missing") &&
          thread.worktreePath === null &&
          project?.deletedAt !== null
        );
      }, "Expected missing Codex worktree import to be reconciled.");
    } finally {
      await system.dispose();
    }
  });

  it("creates projects for existing cwd imports and uses the fallback project when cwd is missing", async () => {
    const serverCwd = makeTempDir("server-fallback-root-");
    const existingCwd = makeTempDir("new-project-root-");
    const missingCwd = path.join(os.tmpdir(), `missing-codex-cwd-${crypto.randomUUID()}`);
    const { homePath } = createCodexHomeFixture([
      {
        sessionId: "new-project-session",
        title: "Needs new project",
        cwd: existingCwd,
        firstUserMessage: "new project import",
        transcript: buildTranscript([
          { role: "user", text: "new project import", timestamp: isoOffset(3) },
          { role: "assistant", text: "ok", timestamp: isoOffset(2) },
        ]),
      },
      {
        sessionId: "fallback-session",
        title: "Needs fallback",
        cwd: missingCwd,
        firstUserMessage: "fallback import",
        transcript: buildTranscript([
          { role: "user", text: "fallback import", timestamp: isoOffset(4) },
          { role: "assistant", text: "ok", timestamp: isoOffset(3) },
        ]),
      },
    ]);
    const system = await createCodexImportSystem(serverCwd);

    try {
      const imported = await system.run(
        Effect.gen(function* () {
          const codexImport = yield* CodexImport;
          return yield* codexImport.importSessions({
            homePath,
            sessionIds: ["new-project-session", "fallback-session"],
          });
        }),
      );

      expect(imported.results.map((result) => result.status)).toEqual(["imported", "imported"]);
      await waitFor(async () => {
        const snapshot = await system.run(
          Effect.gen(function* () {
            const snapshots = yield* ProjectionSnapshotQuery;
            return yield* snapshots.getSnapshot();
          }),
        );
        return (
          snapshot.projects.some(
            (project) => project.workspaceRoot === canonicalPath(existingCwd),
          ) &&
          snapshot.projects.some(
            (project) => project.id === ProjectId.makeUnsafe("codex-import-fallback"),
          )
        );
      }, "Expected imported projects to be projected.");

      const snapshot = await system.run(
        Effect.gen(function* () {
          const snapshots = yield* ProjectionSnapshotQuery;
          return yield* snapshots.getSnapshot();
        }),
      );

      const createdProject = snapshot.projects.find(
        (project) => project.workspaceRoot === canonicalPath(existingCwd),
      );
      expect(createdProject?.title).toBe(path.basename(existingCwd));

      const fallbackProject = snapshot.projects.find(
        (project) => project.id === ProjectId.makeUnsafe("codex-import-fallback"),
      );
      expect(fallbackProject).toMatchObject({
        id: ProjectId.makeUnsafe("codex-import-fallback"),
        title: "Imported from Codex",
        workspaceRoot: canonicalPath(serverCwd),
      });

      const newProjectThread = snapshot.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("codex-import-new-project-session"),
      );
      expect(newProjectThread?.projectId).toBe(createdProject?.id);

      const fallbackThread = snapshot.threads.find(
        (thread) => thread.id === ThreadId.makeUnsafe("codex-import-fallback-session"),
      );
      expect(fallbackThread?.projectId).toBe(ProjectId.makeUnsafe("codex-import-fallback"));

      const fallbackBinding = await system.run(
        Effect.gen(function* () {
          const directory = yield* ProviderSessionDirectory;
          return yield* directory.getBinding(ThreadId.makeUnsafe("codex-import-fallback-session"));
        }),
      );
      expect(Option.isSome(fallbackBinding)).toBe(true);
      if (Option.isSome(fallbackBinding)) {
        expect(fallbackBinding.value.runtimePayload).toMatchObject({
          cwd: missingCwd,
        });
      }
    } finally {
      await system.dispose();
    }
  });
});
