import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationThread,
} from "@t3tools/contracts";
import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationSessionStatus,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Option, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { TurnQueueReactor } from "../Services/TurnQueueReactor.ts";
import { TurnQueueReactorLive } from "./TurnQueueReactor.ts";

const PROJECT_ID = ProjectId.makeUnsafe("project-turn-queue-reactor");
const THREAD_ID = ThreadId.makeUnsafe("thread-turn-queue-reactor");
const TURN_ID = TurnId.makeUnsafe("turn-turn-queue-reactor");
const CREATED_AT = "2026-03-12T12:00:00.000Z";

function createThread(
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationReadModel["threads"][number] {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Queue reactor thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TURN_ID,
      state: "running",
      requestedAt: CREATED_AT,
      startedAt: CREATED_AT,
      completedAt: null,
      assistantMessageId: null,
    },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    messages: [],
    queuedTurns: [
      {
        messageId: MessageId.makeUnsafe("message-queued-1"),
        text: "Queued follow-up",
        attachments: [],
        provider: "codex",
        model: "gpt-5",
        serviceTier: null,
        modelOptions: null,
        providerOptions: null,
        assistantDeliveryMode: "buffered",
        runtimeMode: "full-access",
        interactionMode: "default",
        queuedAt: CREATED_AT,
      },
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: {
      threadId: THREAD_ID,
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: TURN_ID,
      lastError: null,
      updatedAt: CREATED_AT,
    },
    ...overrides,
  };
}

function createReadModel(thread: OrchestrationThread): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [thread],
    updatedAt: thread.updatedAt,
  };
}

function createSessionSetEvent(status: OrchestrationSessionStatus): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.makeUnsafe(`evt-turn-queue-reactor-${status}`),
    type: "thread.session-set",
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: CREATED_AT,
    commandId: CommandId.makeUnsafe(`cmd-turn-queue-reactor-${status}`),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(`cmd-turn-queue-reactor-${status}`),
    metadata: {},
    payload: {
      threadId: THREAD_ID,
      session: {
        threadId: THREAD_ID,
        status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: status === "running" ? TURN_ID : null,
        lastError: status === "error" ? "Tunnel lost" : null,
        updatedAt: CREATED_AT,
      },
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for expected reactor state");
}

describe("TurnQueueReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<TurnQueueReactor, never> | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("does not auto-promote queued turns after a session error", async () => {
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatchedCommands: string[] = [];
    let readModel = createReadModel(createThread());

    runtime = ManagedRuntime.make(
      TurnQueueReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            getReadModel: () => Effect.succeed(readModel),
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command.type);
                return { sequence: dispatchedCommands.length };
              }),
            streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionTurnRepository, {
            upsertByTurnId: () => Effect.void,
            replacePendingTurnStart: () => Effect.void,
            getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
            deletePendingTurnStartByThreadId: () => Effect.void,
            listByThreadId: () => Effect.succeed([]),
            getByTurnId: () => Effect.succeed(Option.none()),
            clearCheckpointTurnConflict: () => Effect.void,
            deleteByThreadId: () => Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(TurnQueueReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    readModel = createReadModel(
      createThread({
        latestTurn: {
          turnId: TURN_ID,
          state: "error",
          requestedAt: CREATED_AT,
          startedAt: CREATED_AT,
          completedAt: CREATED_AT,
          assistantMessageId: null,
        },
        session: {
          threadId: THREAD_ID,
          status: "error",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "Tunnel lost",
          updatedAt: CREATED_AT,
        },
      }),
    );

    Effect.runSync(PubSub.publish(domainEventPubSub, createSessionSetEvent("error")));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dispatchedCommands).toEqual([]);
  });

  it("still auto-promotes queued turns when a session becomes ready", async () => {
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatchedCommands: string[] = [];
    let readModel = createReadModel(createThread());

    runtime = ManagedRuntime.make(
      TurnQueueReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            getReadModel: () => Effect.succeed(readModel),
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command.type);
                return { sequence: dispatchedCommands.length };
              }),
            streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionTurnRepository, {
            upsertByTurnId: () => Effect.void,
            replacePendingTurnStart: () => Effect.void,
            getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
            deletePendingTurnStartByThreadId: () => Effect.void,
            listByThreadId: () => Effect.succeed([]),
            getByTurnId: () => Effect.succeed(Option.none()),
            clearCheckpointTurnConflict: () => Effect.void,
            deleteByThreadId: () => Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(TurnQueueReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    readModel = createReadModel(
      createThread({
        latestTurn: {
          turnId: TURN_ID,
          state: "completed",
          requestedAt: CREATED_AT,
          startedAt: CREATED_AT,
          completedAt: CREATED_AT,
          assistantMessageId: null,
        },
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: CREATED_AT,
        },
      }),
    );

    Effect.runSync(PubSub.publish(domainEventPubSub, createSessionSetEvent("ready")));
    await waitFor(() => dispatchedCommands.includes("thread.turn.queue.promote"));

    expect(dispatchedCommands).toEqual(["thread.turn.queue.promote"]);
  });

  it("clears a stale pending turn start before promoting the next queued follow-up", async () => {
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatchedCommands: string[] = [];
    let pendingTurnStartPresent = true;
    let deletePendingTurnStartCalls = 0;
    let readModel = createReadModel(createThread());

    runtime = ManagedRuntime.make(
      TurnQueueReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            getReadModel: () => Effect.succeed(readModel),
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command.type);
                return { sequence: dispatchedCommands.length };
              }),
            streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionTurnRepository, {
            upsertByTurnId: () => Effect.void,
            replacePendingTurnStart: () => Effect.void,
            getPendingTurnStartByThreadId: () =>
              Effect.succeed(
                pendingTurnStartPresent
                  ? Option.some({
                      threadId: THREAD_ID,
                      messageId: MessageId.makeUnsafe("message-stale-pending"),
                      sourceProposedPlanThreadId: null,
                      sourceProposedPlanId: null,
                      requestedAt: CREATED_AT,
                    })
                  : Option.none(),
              ),
            deletePendingTurnStartByThreadId: () =>
              Effect.sync(() => {
                pendingTurnStartPresent = false;
                deletePendingTurnStartCalls += 1;
              }),
            listByThreadId: () => Effect.succeed([]),
            getByTurnId: () => Effect.succeed(Option.none()),
            clearCheckpointTurnConflict: () => Effect.void,
            deleteByThreadId: () => Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(TurnQueueReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    readModel = createReadModel(
      createThread({
        latestTurn: {
          turnId: TURN_ID,
          state: "completed",
          requestedAt: CREATED_AT,
          startedAt: CREATED_AT,
          completedAt: CREATED_AT,
          assistantMessageId: null,
        },
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: CREATED_AT,
        },
      }),
    );

    Effect.runSync(PubSub.publish(domainEventPubSub, createSessionSetEvent("ready")));
    await waitFor(() => dispatchedCommands.includes("thread.turn.queue.promote"));

    expect(deletePendingTurnStartCalls).toBe(1);
    expect(dispatchedCommands).toEqual(["thread.turn.queue.promote"]);
  });

  it("does not clear a pending turn start when it still matches the queued head", async () => {
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatchedCommands: string[] = [];
    let deletePendingTurnStartCalls = 0;
    let readModel = createReadModel(createThread());

    runtime = ManagedRuntime.make(
      TurnQueueReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            getReadModel: () => Effect.succeed(readModel),
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command.type);
                return { sequence: dispatchedCommands.length };
              }),
            streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionTurnRepository, {
            upsertByTurnId: () => Effect.void,
            replacePendingTurnStart: () => Effect.void,
            getPendingTurnStartByThreadId: () =>
              Effect.succeed(
                Option.some({
                  threadId: THREAD_ID,
                  messageId: MessageId.makeUnsafe("message-queued-1"),
                  sourceProposedPlanThreadId: null,
                  sourceProposedPlanId: null,
                  requestedAt: CREATED_AT,
                }),
              ),
            deletePendingTurnStartByThreadId: () =>
              Effect.sync(() => {
                deletePendingTurnStartCalls += 1;
              }),
            listByThreadId: () => Effect.succeed([]),
            getByTurnId: () => Effect.succeed(Option.none()),
            clearCheckpointTurnConflict: () => Effect.void,
            deleteByThreadId: () => Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(TurnQueueReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    readModel = createReadModel(
      createThread({
        latestTurn: {
          turnId: TURN_ID,
          state: "completed",
          requestedAt: CREATED_AT,
          startedAt: CREATED_AT,
          completedAt: CREATED_AT,
          assistantMessageId: null,
        },
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: CREATED_AT,
        },
      }),
    );

    Effect.runSync(PubSub.publish(domainEventPubSub, createSessionSetEvent("ready")));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(deletePendingTurnStartCalls).toBe(0);
    expect(dispatchedCommands).toEqual([]);
  });

  it("recovers from a stale pending turn start during bootstrap", async () => {
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatchedCommands: string[] = [];
    let pendingTurnStartPresent = true;
    let deletePendingTurnStartCalls = 0;

    runtime = ManagedRuntime.make(
      TurnQueueReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            getReadModel: () =>
              Effect.succeed(
                createReadModel(
                  createThread({
                    latestTurn: {
                      turnId: TURN_ID,
                      state: "completed",
                      requestedAt: CREATED_AT,
                      startedAt: CREATED_AT,
                      completedAt: CREATED_AT,
                      assistantMessageId: null,
                    },
                    session: {
                      threadId: THREAD_ID,
                      status: "ready",
                      providerName: "codex",
                      runtimeMode: "full-access",
                      activeTurnId: null,
                      lastError: null,
                      updatedAt: CREATED_AT,
                    },
                  }),
                ),
              ),
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command.type);
                return { sequence: dispatchedCommands.length };
              }),
            streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionTurnRepository, {
            upsertByTurnId: () => Effect.void,
            replacePendingTurnStart: () => Effect.void,
            getPendingTurnStartByThreadId: () =>
              Effect.succeed(
                pendingTurnStartPresent
                  ? Option.some({
                      threadId: THREAD_ID,
                      messageId: MessageId.makeUnsafe("message-stale-pending"),
                      sourceProposedPlanThreadId: null,
                      sourceProposedPlanId: null,
                      requestedAt: CREATED_AT,
                    })
                  : Option.none(),
              ),
            deletePendingTurnStartByThreadId: () =>
              Effect.sync(() => {
                pendingTurnStartPresent = false;
                deletePendingTurnStartCalls += 1;
              }),
            listByThreadId: () => Effect.succeed([]),
            getByTurnId: () => Effect.succeed(Option.none()),
            clearCheckpointTurnConflict: () => Effect.void,
            deleteByThreadId: () => Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(TurnQueueReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    await waitFor(() => dispatchedCommands.includes("thread.turn.queue.promote"));

    expect(deletePendingTurnStartCalls).toBe(1);
    expect(dispatchedCommands).toEqual(["thread.turn.queue.promote"]);
  });

  it("uses the projected latest turn state when the in-memory latest turn is stale", async () => {
    const domainEventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const dispatchedCommands: string[] = [];
    let readModel = createReadModel(createThread());

    runtime = ManagedRuntime.make(
      TurnQueueReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, {
            getReadModel: () => Effect.succeed(readModel),
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                dispatchedCommands.push(command.type);
                return { sequence: dispatchedCommands.length };
              }),
            streamDomainEvents: Stream.fromPubSub(domainEventPubSub),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProjectionTurnRepository, {
            upsertByTurnId: () => Effect.void,
            replacePendingTurnStart: () => Effect.void,
            getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
            deletePendingTurnStartByThreadId: () => Effect.void,
            listByThreadId: () => Effect.succeed([]),
            getByTurnId: () =>
              Effect.succeed(
                Option.some({
                  turnId: TURN_ID,
                  threadId: THREAD_ID,
                  pendingMessageId: MessageId.makeUnsafe("message-original"),
                  assistantMessageId: MessageId.makeUnsafe("message-assistant"),
                  state: "completed" as const,
                  requestedAt: CREATED_AT,
                  startedAt: CREATED_AT,
                  completedAt: CREATED_AT,
                  sourceProposedPlanThreadId: null,
                  sourceProposedPlanId: null,
                  checkpointTurnCount: null,
                  checkpointRef: null,
                  checkpointStatus: null,
                  checkpointFiles: [],
                }),
              ),
            clearCheckpointTurnConflict: () => Effect.void,
            deleteByThreadId: () => Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(TurnQueueReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    readModel = createReadModel(
      createThread({
        latestTurn: {
          turnId: TURN_ID,
          state: "running",
          requestedAt: CREATED_AT,
          startedAt: CREATED_AT,
          completedAt: null,
          assistantMessageId: null,
        },
        session: {
          threadId: THREAD_ID,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: CREATED_AT,
        },
      }),
    );

    Effect.runSync(PubSub.publish(domainEventPubSub, createSessionSetEvent("ready")));
    await waitFor(() => dispatchedCommands.includes("thread.turn.queue.promote"));

    expect(dispatchedCommands).toEqual(["thread.turn.queue.promote"]);
  });
});
