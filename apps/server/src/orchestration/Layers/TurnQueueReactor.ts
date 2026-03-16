import {
  CommandId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ThreadId,
} from "@t3tools/contracts";
import { Cause, Effect, Layer, Option, Queue, Stream } from "effect";

import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { TurnQueueReactor, type TurnQueueReactorShape } from "../Services/TurnQueueReactor.ts";

type TurnQueueRelevantEvent = Extract<
  OrchestrationEvent,
  {
    type: "thread.turn-queued" | "thread.turn-queue-removed" | "thread.session-set";
  }
>;

type ReactorInput =
  | {
      readonly source: "bootstrap";
      readonly threadId: ThreadId;
    }
  | {
      readonly source: "domain";
      readonly event: TurnQueueRelevantEvent;
    };

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

function shouldPauseQueuedTurnDispatch(thread: OrchestrationThread): boolean {
  const sessionStatus = thread.session?.status;
  return sessionStatus === "error" || sessionStatus === "interrupted";
}

function canDispatchQueuedTurn(thread: OrchestrationThread): boolean {
  if (thread.deletedAt !== null) {
    return false;
  }

  if (shouldPauseQueuedTurnDispatch(thread)) {
    return false;
  }

  const sessionStatus = thread.session?.status;
  if (sessionStatus === "running" || sessionStatus === "starting") {
    return false;
  }

  return true;
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const promotionInFlightByThreadId = new Set<ThreadId>();

  const clearPromotionInFlight = (threadId: ThreadId) =>
    Effect.sync(() => {
      promotionInFlightByThreadId.delete(threadId);
    });

  const maybeRemoveConfirmedQueuedHead = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
        threadId,
      });
      if (Option.isNone(pendingTurnStart)) {
        yield* clearPromotionInFlight(threadId);
        return;
      }

      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === threadId);
      const headQueuedTurn = thread?.queuedTurns[0] ?? null;
      if (
        !thread ||
        !headQueuedTurn ||
        headQueuedTurn.messageId !== pendingTurnStart.value.messageId
      ) {
        yield* clearPromotionInFlight(threadId);
        return;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.queue.remove",
        commandId: serverCommandId("queued-turn-confirmed-start-remove"),
        threadId,
        messageId: headQueuedTurn.messageId,
        createdAt: new Date().toISOString(),
      });
      yield* clearPromotionInFlight(threadId);
    });

  const attemptDispatchNextQueuedTurn = (threadId: ThreadId) =>
    Effect.gen(function* () {
      if (promotionInFlightByThreadId.has(threadId)) {
        return;
      }

      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === threadId);
      if (!thread || !canDispatchQueuedTurn(thread)) {
        return;
      }

      if (thread.latestTurn?.state === "running") {
        const projectedLatestTurn = yield* projectionTurnRepository.getByTurnId({
          threadId,
          turnId: thread.latestTurn.turnId,
        });
        if (
          Option.isNone(projectedLatestTurn) ||
          projectedLatestTurn.value.state === "pending" ||
          projectedLatestTurn.value.state === "running"
        ) {
          return;
        }
      }

      const nextQueuedTurn = thread.queuedTurns[0];
      if (!nextQueuedTurn) {
        return;
      }

      const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
        threadId,
      });
      if (Option.isSome(pendingTurnStart)) {
        return;
      }

      promotionInFlightByThreadId.add(threadId);
      const dispatchAt = new Date().toISOString();

      const promoteQueuedTurn = Effect.gen(function* () {
        if (nextQueuedTurn.model !== null && nextQueuedTurn.model !== thread.model) {
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: serverCommandId("queued-turn-model-sync"),
            threadId,
            model: nextQueuedTurn.model,
          });
        }

        if (nextQueuedTurn.runtimeMode !== thread.runtimeMode) {
          yield* orchestrationEngine.dispatch({
            type: "thread.runtime-mode.set",
            commandId: serverCommandId("queued-turn-runtime-mode-sync"),
            threadId,
            runtimeMode: nextQueuedTurn.runtimeMode,
            createdAt: dispatchAt,
          });
        }

        if (nextQueuedTurn.interactionMode !== thread.interactionMode) {
          yield* orchestrationEngine.dispatch({
            type: "thread.interaction-mode.set",
            commandId: serverCommandId("queued-turn-interaction-mode-sync"),
            threadId,
            interactionMode: nextQueuedTurn.interactionMode,
            createdAt: dispatchAt,
          });
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.turn.queue.promote",
          commandId: serverCommandId("queued-turn-promote"),
          threadId,
          messageId: nextQueuedTurn.messageId,
          createdAt: dispatchAt,
        });
      });

      yield* promoteQueuedTurn.pipe(
        Effect.catchCause((cause) =>
          clearPromotionInFlight(threadId).pipe(Effect.flatMap(() => Effect.failCause(cause))),
        ),
      );
    });

  const processInput = (input: ReactorInput) =>
    Effect.gen(function* () {
      if (input.source === "bootstrap") {
        yield* attemptDispatchNextQueuedTurn(input.threadId);
        return;
      }

      const event = input.event;
      switch (event.type) {
        case "thread.turn-queued":
        case "thread.turn-queue-removed": {
          yield* attemptDispatchNextQueuedTurn(event.payload.threadId);
          return;
        }

        case "thread.session-set": {
          const threadId = event.payload.threadId;
          const status = event.payload.session.status;
          if (status === "running") {
            yield* maybeRemoveConfirmedQueuedHead(threadId);
            return;
          }

          if (status === "ready" || status === "error" || status === "interrupted") {
            yield* clearPromotionInFlight(threadId);
          }

          if (status === "error" || status === "interrupted") {
            return;
          }

          yield* attemptDispatchNextQueuedTurn(threadId);
          return;
        }
      }
    });

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("turn queue reactor failed to process input", {
          source: input.source,
          ...(input.source === "domain"
            ? { eventType: input.event.type, threadId: input.event.payload.threadId }
            : { threadId: input.threadId }),
          cause: Cause.pretty(cause),
        });
      }),
    );

  const start: TurnQueueReactorShape["start"] = Effect.gen(function* () {
    const queue = yield* Queue.unbounded<ReactorInput>();
    yield* Effect.addFinalizer(() => Queue.shutdown(queue).pipe(Effect.asVoid));

    yield* Effect.forkScoped(
      Effect.forever(Queue.take(queue).pipe(Effect.flatMap(processInputSafely))),
    );

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-queued" &&
          event.type !== "thread.turn-queue-removed" &&
          event.type !== "thread.session-set"
        ) {
          return Effect.void;
        }

        return Queue.offer(queue, {
          source: "domain",
          event,
        }).pipe(Effect.asVoid);
      }),
    );

    const readModel = yield* orchestrationEngine.getReadModel();
    yield* Effect.forEach(
      readModel.threads,
      (thread) =>
        thread.queuedTurns.length === 0 || shouldPauseQueuedTurnDispatch(thread)
          ? Effect.void
          : Queue.offer(queue, {
              source: "bootstrap",
              threadId: thread.id,
            }).pipe(Effect.asVoid),
      { concurrency: 1 },
    ).pipe(Effect.asVoid);
  });

  return {
    start,
  } satisfies TurnQueueReactorShape;
});

export const TurnQueueReactorLive = Layer.effect(TurnQueueReactor, make);
