import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const PROJECT_ID = ProjectId.makeUnsafe("project-queue-tests");
const THREAD_ID = ThreadId.makeUnsafe("thread-queue-tests");

function eventFrom(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  occurredAt: string;
  commandId: string;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`evt-queue-${input.sequence}`),
    type: input.type,
    aggregateKind: input.type.startsWith("project.") ? "project" : "thread",
    aggregateId: input.type.startsWith("project.") ? PROJECT_ID : THREAD_ID,
    occurredAt: input.occurredAt,
    commandId: CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: CommandId.makeUnsafe(input.commandId),
    metadata: {},
    payload: input.payload as never,
  };
}

async function createReadModelWithQueuedTurns() {
  const createdAt = "2026-03-08T12:00:00.000Z";
  const initial = createEmptyReadModel(createdAt);
  const withProject = await Effect.runPromise(
    projectEvent(
      initial,
      eventFrom({
        sequence: 1,
        type: "project.created",
        occurredAt: createdAt,
        commandId: "cmd-project-create",
        payload: {
          projectId: PROJECT_ID,
          title: "Queue tests",
          workspaceRoot: "/tmp/queue-tests",
          defaultModel: null,
          scripts: [],
          createdAt,
          updatedAt: createdAt,
        },
      }),
    ),
  );
  const withThread = await Effect.runPromise(
    projectEvent(
      withProject,
      eventFrom({
        sequence: 2,
        type: "thread.created",
        occurredAt: createdAt,
        commandId: "cmd-thread-create",
        payload: {
          threadId: THREAD_ID,
          projectId: PROJECT_ID,
          title: "Queue thread",
          model: "gpt-5",
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    ),
  );

  let readModel = withThread;
  for (const [index, messageId] of ["message-a", "message-b", "message-c"].entries()) {
    const queuedAt = `2026-03-08T12:00:0${index}.000Z`;
    readModel = await Effect.runPromise(
      projectEvent(
        readModel,
        eventFrom({
          sequence: index + 3,
          type: "thread.turn-queued",
          occurredAt: queuedAt,
          commandId: `cmd-queue-${messageId}`,
          payload: {
            threadId: THREAD_ID,
            queuedTurn: {
              messageId: MessageId.makeUnsafe(messageId),
              text: `Queued ${messageId}`,
              attachments: [],
              provider: "codex",
              model: "gpt-5",
              serviceTier: null,
              modelOptions: null,
              providerOptions: null,
              assistantDeliveryMode: "buffered",
              runtimeMode: "full-access",
              interactionMode: "default",
              queuedAt,
            },
          },
        }),
      ),
    );
  }

  return readModel;
}

describe("decider queued turns", () => {
  it("updates queued turn text without changing its place in line", async () => {
    const readModel = await createReadModelWithQueuedTurns();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.queue.update",
          commandId: CommandId.makeUnsafe("cmd-queue-update"),
          threadId: THREAD_ID,
          messageId: MessageId.makeUnsafe("message-b"),
          text: "Updated second queued turn",
          createdAt: "2026-03-08T12:01:00.000Z",
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(false);
    const event = Array.isArray(result) ? result[0] : result;
    expect(event?.type).toBe("thread.turn-queue-updated");
    if (!event || event.type !== "thread.turn-queue-updated") {
      return;
    }
    expect(event.payload.queuedTurn.messageId).toBe("message-b");
    expect(event.payload.queuedTurn.text).toBe("Updated second queued turn");
    expect(event.payload.queuedTurn.queuedAt).toBe("2026-03-08T12:00:01.000Z");
  });

  it("reorders queued turns relative to the hovered target", async () => {
    const readModel = await createReadModelWithQueuedTurns();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.queue.move",
          commandId: CommandId.makeUnsafe("cmd-queue-move"),
          threadId: THREAD_ID,
          messageId: MessageId.makeUnsafe("message-c"),
          targetMessageId: MessageId.makeUnsafe("message-a"),
          createdAt: "2026-03-08T12:02:00.000Z",
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(false);
    const event = Array.isArray(result) ? result[0] : result;
    expect(event?.type).toBe("thread.turn-queue-moved");
    if (!event || event.type !== "thread.turn-queue-moved") {
      return;
    }
    expect(event.payload.messageId).toBe("message-c");
    expect(event.payload.targetMessageId).toBe("message-a");
  });

  it("removes the selected queued turn and emits an immediate turn start for send-now", async () => {
    const readModel = await createReadModelWithQueuedTurns();

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.queue.send-now",
          commandId: CommandId.makeUnsafe("cmd-queue-send-now"),
          threadId: THREAD_ID,
          messageId: MessageId.makeUnsafe("message-b"),
          createdAt: "2026-03-08T12:03:00.000Z",
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) {
      return;
    }

    expect(result.map((event) => event.type)).toEqual([
      "thread.turn-queue-removed",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(result[0]?.payload).toMatchObject({
      threadId: THREAD_ID,
      messageId: MessageId.makeUnsafe("message-b"),
    });
    expect(result[1]?.payload).toMatchObject({
      threadId: THREAD_ID,
      messageId: MessageId.makeUnsafe("message-b"),
      text: "Queued message-b",
    });
    expect(result[2]?.payload).toMatchObject({
      threadId: THREAD_ID,
      messageId: MessageId.makeUnsafe("message-b"),
      provider: "codex",
      model: "gpt-5",
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });

  it("syncs queued turn thread settings before send-now dispatches immediately", async () => {
    const baseReadModel = await createReadModelWithQueuedTurns();
    const readModel = await Effect.runPromise(
      projectEvent(
        baseReadModel,
        eventFrom({
          sequence: 6,
          type: "thread.turn-queue-updated",
          occurredAt: "2026-03-08T12:03:30.000Z",
          commandId: "cmd-queue-update-settings",
          payload: {
            threadId: THREAD_ID,
            queuedTurn: {
              messageId: MessageId.makeUnsafe("message-a"),
              text: "Queued message-a",
              attachments: [],
              provider: "codex",
              model: "gpt-5.1",
              serviceTier: null,
              modelOptions: null,
              providerOptions: null,
              assistantDeliveryMode: "buffered",
              runtimeMode: "approval-required",
              interactionMode: "plan",
              queuedAt: "2026-03-08T12:00:00.000Z",
            },
          },
        }),
      ),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.queue.send-now",
          commandId: CommandId.makeUnsafe("cmd-queue-send-now-head"),
          threadId: THREAD_ID,
          messageId: MessageId.makeUnsafe("message-a"),
          createdAt: "2026-03-08T12:04:00.000Z",
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) {
      return;
    }

    expect(result.map((event) => event.type)).toEqual([
      "thread.meta-updated",
      "thread.runtime-mode-set",
      "thread.interaction-mode-set",
      "thread.turn-queue-removed",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(result[0]?.payload).toMatchObject({
      threadId: THREAD_ID,
      model: "gpt-5.1",
    });
    expect(result[1]?.payload).toMatchObject({
      threadId: THREAD_ID,
      runtimeMode: "approval-required",
    });
    expect(result[2]?.payload).toMatchObject({
      threadId: THREAD_ID,
      interactionMode: "plan",
    });
    expect(result[5]?.payload).toMatchObject({
      threadId: THREAD_ID,
      messageId: MessageId.makeUnsafe("message-a"),
      model: "gpt-5.1",
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
  });
});
