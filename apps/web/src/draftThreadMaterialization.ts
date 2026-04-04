import {
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  type OrchestrationEvent,
  type ThreadId,
} from "@t3tools/contracts";
import { truncate } from "@t3tools/shared/String";
import type { DraftThreadState } from "./composerDraftStore";
import type { Project } from "./types";

interface SynthesizeDraftThreadCreatedEventsInput {
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly existingThreadIds: ReadonlySet<ThreadId>;
  readonly projects: ReadonlyArray<Project>;
  readonly draftThreadsByThreadId: Record<ThreadId, DraftThreadState>;
}

const NON_MATERIALIZING_THREAD_EVENTS = new Set<OrchestrationEvent["type"]>([
  "thread.created",
  "thread.deleted",
]);

function deriveSyntheticTitle(event: OrchestrationEvent): string {
  switch (event.type) {
    case "thread.message-sent":
      if (event.payload.role === "user" && event.payload.text.trim().length > 0) {
        return truncate(event.payload.text);
      }
      return "New thread";
    case "thread.turn-start-requested":
      return truncate(event.payload.titleSeed ?? "New thread");
    case "thread.meta-updated":
      return event.payload.title ? truncate(event.payload.title) : "New thread";
    default:
      return "New thread";
  }
}

function deriveSyntheticModelSelection(event: OrchestrationEvent, project: Project | undefined) {
  if (event.type === "thread.turn-start-requested" && event.payload.modelSelection) {
    return event.payload.modelSelection;
  }
  if (project?.defaultModelSelection) {
    return project.defaultModelSelection;
  }
  return {
    provider: "codex" as const,
    model: DEFAULT_MODEL_BY_PROVIDER.codex,
  };
}

function deriveSyntheticUpdatedAt(event: OrchestrationEvent): string {
  switch (event.type) {
    case "thread.meta-updated":
    case "thread.runtime-mode-set":
    case "thread.interaction-mode-set":
    case "thread.archived":
    case "thread.unarchived":
      return event.payload.updatedAt;
    case "thread.message-sent":
      return event.payload.updatedAt;
    case "thread.turn-start-requested":
      return event.payload.createdAt;
    case "thread.session-set":
      return event.payload.session.updatedAt;
    case "thread.session-stop-requested":
      return event.payload.createdAt;
    default:
      return event.occurredAt;
  }
}

export function synthesizeDraftThreadCreatedEvents({
  events,
  existingThreadIds,
  projects,
  draftThreadsByThreadId,
}: SynthesizeDraftThreadCreatedEventsInput): OrchestrationEvent[] {
  if (events.length === 0) {
    return [];
  }

  const knownThreadIds = new Set(existingThreadIds);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const syntheticEvents: OrchestrationEvent[] = [];

  for (const event of events) {
    if (event.aggregateKind !== "thread" || NON_MATERIALIZING_THREAD_EVENTS.has(event.type)) {
      if (event.type === "thread.created") {
        knownThreadIds.add(event.payload.threadId);
      }
      continue;
    }

    const threadId = event.aggregateId as ThreadId;
    if (knownThreadIds.has(threadId)) {
      continue;
    }

    const draftThread = draftThreadsByThreadId[threadId];
    if (!draftThread) {
      continue;
    }

    const project = projectsById.get(draftThread.projectId);
    syntheticEvents.push({
      sequence: event.sequence,
      eventId: EventId.makeUnsafe(`synthetic-thread-created-${threadId}-${event.sequence}`),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: event.occurredAt,
      commandId: event.commandId,
      causationEventId: event.eventId,
      correlationId: event.correlationId,
      metadata: {},
      type: "thread.created",
      payload: {
        threadId,
        projectId: draftThread.projectId,
        title: deriveSyntheticTitle(event),
        modelSelection: deriveSyntheticModelSelection(event, project),
        runtimeMode:
          event.type === "thread.turn-start-requested"
            ? event.payload.runtimeMode
            : draftThread.runtimeMode,
        interactionMode:
          event.type === "thread.turn-start-requested"
            ? event.payload.interactionMode
            : draftThread.interactionMode,
        branch: draftThread.branch,
        worktreePath: draftThread.worktreePath,
        createdAt: draftThread.createdAt,
        updatedAt: deriveSyntheticUpdatedAt(event),
      },
    });
    knownThreadIds.add(threadId);
  }

  return syntheticEvents;
}
