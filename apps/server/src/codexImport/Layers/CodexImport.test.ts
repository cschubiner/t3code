import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  readonly updatedAt?: string;
  readonly createdAt?: string;
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
        updated_at TEXT,
        created_at TEXT,
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
      const imported = await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const codexImport = yield* CodexImport;

          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-project-existing"),
            projectId: ProjectId.makeUnsafe("existing-project"),
            title: "Existing project",
            workspaceRoot,
            createdAt: isoOffset(1),
          });

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

      const snapshot = await system.run(
        Effect.gen(function* () {
          const snapshots = yield* ProjectionSnapshotQuery;
          return yield* snapshots.getSnapshot();
        }),
      );

      const createdProject = snapshot.projects.find(
        (project) => project.workspaceRoot === existingCwd,
      );
      expect(createdProject?.title).toBe(path.basename(existingCwd));

      const fallbackProject = snapshot.projects.find(
        (project) => project.id === ProjectId.makeUnsafe("codex-import-fallback"),
      );
      expect(fallbackProject).toMatchObject({
        id: ProjectId.makeUnsafe("codex-import-fallback"),
        title: "Imported from Codex",
        workspaceRoot: serverCwd,
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
