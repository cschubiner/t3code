// Production CSS is part of the behavior under test because row height depends on it.
import "../index.css";

import {
  EventId,
  type KeybindingWhenNode,
  ORCHESTRATION_WS_METHODS,
  type MessageId,
  type OrchestrationReadModel,
  type ProjectId,
  type SkillSearchResult,
  type SnippetId,
  type SnippetListResult,
  type ServerConfig,
  type ThreadId,
  type TurnId,
  type WsWelcomePayload,
  WS_CHANNELS,
  WS_METHODS,
  OrchestrationSessionStatus,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useChatToolbarFocusStore } from "../chatToolbarFocusStore";
import { clearPromotedDraftThreads, useComposerDraftStore } from "../composerDraftStore";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
  removeInlineTerminalContextPlaceholder,
} from "../lib/terminalContext";
import { isMacPlatform } from "../lib/utils";
import { getRouter } from "../router";
import { useStore } from "../store";
import { estimateTimelineMessageHeight } from "./timelineHeight";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

const THREAD_ID = "thread-browser-test" as ThreadId;
const UUID_ROUTE_RE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROJECT_ID = "project-1" as ProjectId;
const NOW_ISO = "2026-03-04T12:00:00.000Z";
const BASE_TIME_MS = Date.parse(NOW_ISO);
const ATTACHMENT_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='300'></svg>";
const dispatchCommandErrorsByType = new Map<string, string>();
const DEFAULT_MODEL_SELECTION = {
  provider: "codex" as const,
  model: "gpt-5",
};

interface WsRequestEnvelope {
  id: string;
  body: {
    _tag: string;
    [key: string]: unknown;
  };
}

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  skillSearchResult: SkillSearchResult;
  snippetListResult: SnippetListResult;
  welcome: WsWelcomePayload;
}

let fixture: TestFixture;
const wsRequests: WsRequestEnvelope["body"][] = [];
const wsRpcOverrides = new Map<
  string,
  (body: WsRequestEnvelope["body"]) => unknown | Promise<unknown>
>();
const wsLink = ws.link(/ws(s)?:\/\/.*/);

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  textTolerancePx: number;
  attachmentTolerancePx: number;
}

const DEFAULT_VIEWPORT: ViewportSpec = {
  name: "desktop",
  width: 960,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
};
const TEXT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "tablet", width: 720, height: 1_024, textTolerancePx: 44, attachmentTolerancePx: 56 },
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];
const ATTACHMENT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  { name: "mobile", width: 430, height: 932, textTolerancePx: 56, attachmentTolerancePx: 56 },
  { name: "narrow", width: 320, height: 700, textTolerancePx: 84, attachmentTolerancePx: 56 },
] as const satisfies readonly ViewportSpec[];

interface UserRowMeasurement {
  measuredRowHeightPx: number;
  timelineWidthMeasuredPx: number;
  renderedInVirtualizedRegion: boolean;
}

interface MountedChatView {
  [Symbol.asyncDispose]: () => Promise<void>;
  cleanup: () => Promise<void>;
  measureUserRow: (targetMessageId: MessageId) => Promise<UserRowMeasurement>;
  setViewport: (viewport: ViewportSpec) => Promise<void>;
  router: ReturnType<typeof getRouter>;
}

function createResolvedKeybinding(
  key: string,
  command: ServerConfig["keybindings"][number]["command"],
  options?: { shiftKey?: boolean; whenAst?: KeybindingWhenNode },
) {
  return {
    command,
    shortcut: {
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: options?.shiftKey ?? false,
      altKey: false,
      modKey: true,
    },
    ...(options?.whenAst ? { whenAst: options.whenAst } : {}),
  } as const;
}

function whenIdentifier(name: string): KeybindingWhenNode {
  return { type: "identifier", name };
}

function whenNot(node: KeybindingWhenNode): KeybindingWhenNode {
  return { type: "not", node };
}

function steerShortcutModifiers(): Pick<KeyboardEventInit, "ctrlKey" | "metaKey" | "shiftKey"> {
  return isMacPlatform(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
}

function modShiftShortcutModifiers(): Pick<KeyboardEventInit, "ctrlKey" | "metaKey" | "shiftKey"> {
  return isMacPlatform(navigator.platform)
    ? { metaKey: true, shiftKey: true }
    : { ctrlKey: true, shiftKey: true };
}

function modShortcutModifiers(options?: {
  shiftKey?: boolean;
}): Pick<KeyboardEventInit, "ctrlKey" | "metaKey" | "shiftKey"> {
  return isMacPlatform(navigator.platform)
    ? { metaKey: true, shiftKey: options?.shiftKey ?? false }
    : { ctrlKey: true, shiftKey: options?.shiftKey ?? false };
}

function isoAt(offsetSeconds: number): string {
  return new Date(BASE_TIME_MS + offsetSeconds * 1_000).toISOString();
}

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [
      createResolvedKeybinding("f", "thread.search", {
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      }),
      createResolvedKeybinding("f", "threads.search", {
        shiftKey: true,
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      }),
      createResolvedKeybinding("s", "snippets.open", {
        shiftKey: true,
        whenAst: whenNot(whenIdentifier("terminalFocus")),
      }),
    ],
    issues: [],
    providers: [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: NOW_ISO,
        models: [],
      },
    ],
    availableEditors: [],
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  };
}

function createUserMessage(options: {
  id: MessageId;
  text: string;
  offsetSeconds: number;
  attachments?: Array<{
    type: "image";
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}) {
  return {
    id: options.id,
    role: "user" as const,
    text: options.text,
    ...(options.attachments ? { attachments: options.attachments } : {}),
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createAssistantMessage(options: { id: MessageId; text: string; offsetSeconds: number }) {
  return {
    id: options.id,
    role: "assistant" as const,
    text: options.text,
    turnId: null,
    streaming: false,
    createdAt: isoAt(options.offsetSeconds),
    updatedAt: isoAt(options.offsetSeconds + 1),
  };
}

function createTerminalContext(input: {
  id: string;
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
  text: string;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: THREAD_ID,
    terminalId: `terminal-${input.id}`,
    terminalLabel: input.terminalLabel,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    text: input.text,
    createdAt: NOW_ISO,
  };
}

function createThreadRecord(options: {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  createdAt: string;
  updatedAt?: string;
  messages?: OrchestrationReadModel["threads"][number]["messages"];
  proposedPlans?: OrchestrationReadModel["threads"][number]["proposedPlans"];
  activities?: OrchestrationReadModel["threads"][number]["activities"];
}): OrchestrationReadModel["threads"][number] {
  const updatedAt = options.updatedAt ?? options.createdAt;
  return {
    id: options.id,
    projectId: options.projectId,
    title: options.title,
    modelSelection: DEFAULT_MODEL_SELECTION,
    interactionMode: "default",
    runtimeMode: "full-access",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: options.createdAt,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
    messages: options.messages ?? [],
    queuedTurns: [],
    activities: options.activities ?? [],
    proposedPlans: options.proposedPlans ?? [],
    checkpoints: [],
    session: {
      threadId: options.id,
      status: "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt,
    },
  };
}

function createSnapshotForTargetUser(options: {
  targetMessageId: MessageId;
  targetText: string;
  targetAttachmentCount?: number;
  sessionStatus?: OrchestrationSessionStatus;
}): OrchestrationReadModel {
  const messages: Array<OrchestrationReadModel["threads"][number]["messages"][number]> = [];

  for (let index = 0; index < 22; index += 1) {
    const isTarget = index === 3;
    const userId = `msg-user-${index}` as MessageId;
    const assistantId = `msg-assistant-${index}` as MessageId;
    const attachments =
      isTarget && (options.targetAttachmentCount ?? 0) > 0
        ? Array.from({ length: options.targetAttachmentCount ?? 0 }, (_, attachmentIndex) => ({
            type: "image" as const,
            id: `attachment-${attachmentIndex + 1}`,
            name: `attachment-${attachmentIndex + 1}.png`,
            mimeType: "image/png",
            sizeBytes: 128,
          }))
        : undefined;

    messages.push(
      createUserMessage({
        id: isTarget ? options.targetMessageId : userId,
        text: isTarget ? options.targetText : `filler user message ${index}`,
        offsetSeconds: messages.length * 3,
        ...(attachments ? { attachments } : {}),
      }),
    );
    messages.push(
      createAssistantMessage({
        id: assistantId,
        text: `assistant filler ${index}`,
        offsetSeconds: messages.length * 3,
      }),
    );
  }

  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Browser test thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages,
        queuedTurns: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId: THREAD_ID,
          status: options.sessionStatus ?? "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(snapshot: OrchestrationReadModel): TestFixture {
  return {
    snapshot,
    serverConfig: createBaseServerConfig(),
    skillSearchResult: {
      skills: [],
      truncated: false,
    },
    snippetListResult: {
      snippets: [],
    },
    welcome: {
      cwd: "/repo/project",
      projectName: "Project",
      bootstrapProjectId: PROJECT_ID,
      bootstrapThreadId: THREAD_ID,
    },
  };
}

function addThreadToSnapshot(
  snapshot: OrchestrationReadModel,
  threadId: ThreadId,
): OrchestrationReadModel {
  return {
    ...snapshot,
    snapshotSequence: snapshot.snapshotSequence + 1,
    threads: [
      ...snapshot.threads,
      {
        id: threadId,
        projectId: PROJECT_ID,
        title: "New thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: "main",
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        queuedTurns: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW_ISO,
        },
      },
    ],
  };
}

function createSnapshotForGlobalThreadSearch(): OrchestrationReadModel {
  const metadataProjectId = "project-metadata-only" as ProjectId;
  const contentThreadId = "thread-global-content" as ThreadId;
  const titleThreadId = "thread-global-title" as ThreadId;
  const metadataThreadId = "thread-global-metadata" as ThreadId;
  const worklogThreadId = "thread-global-worklog" as ThreadId;

  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: DEFAULT_MODEL_SELECTION,
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
      {
        id: metadataProjectId,
        title: "Gamma Workspace",
        workspaceRoot: "/repo/gamma",
        defaultModelSelection: DEFAULT_MODEL_SELECTION,
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      createThreadRecord({
        id: THREAD_ID,
        projectId: PROJECT_ID,
        title: "Browser test thread",
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        messages: [
          createUserMessage({
            id: "msg-user-global-active" as MessageId,
            text: "local active thread message",
            offsetSeconds: 0,
          }),
        ],
      }),
      createThreadRecord({
        id: contentThreadId,
        projectId: PROJECT_ID,
        title: "Cross-thread assistant result",
        createdAt: "2026-03-04T12:05:00.000Z",
        updatedAt: "2026-03-04T12:05:02.000Z",
        messages: [
          createAssistantMessage({
            id: "msg-assistant-global-content" as MessageId,
            text: "[Visible global needle](https://hidden.example.com/needle) plus another needle",
            offsetSeconds: 300,
          }),
        ],
      }),
      createThreadRecord({
        id: titleThreadId,
        projectId: PROJECT_ID,
        title: "Header Needle Destination",
        createdAt: "2026-03-04T12:03:00.000Z",
        updatedAt: "2026-03-04T12:03:00.000Z",
        messages: [
          createUserMessage({
            id: "msg-user-title-only" as MessageId,
            text: "ordinary content only",
            offsetSeconds: 180,
          }),
        ],
      }),
      createThreadRecord({
        id: metadataThreadId,
        projectId: metadataProjectId,
        title: "Plain thread title",
        createdAt: "2026-03-04T12:02:00.000Z",
        updatedAt: "2026-03-04T12:02:00.000Z",
        messages: [
          createUserMessage({
            id: "msg-user-metadata" as MessageId,
            text: "ordinary content only",
            offsetSeconds: 120,
          }),
        ],
      }),
      createThreadRecord({
        id: worklogThreadId,
        projectId: PROJECT_ID,
        title: "Work log only thread",
        createdAt: "2026-03-04T12:01:00.000Z",
        updatedAt: "2026-03-04T12:01:00.000Z",
        activities: [
          {
            id: EventId.makeUnsafe("event-global-search-worklog"),
            tone: "tool",
            kind: "tool.started",
            summary: "activity-only-needle",
            payload: {},
            turnId: null,
            createdAt: "2026-03-04T12:01:00.000Z",
          },
        ],
      }),
    ],
    updatedAt: NOW_ISO,
  };
}

function createDraftOnlySnapshot(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-draft-target" as MessageId,
    targetText: "draft thread",
  });
  return {
    ...snapshot,
    threads: [],
  };
}

function withProjectScripts(
  snapshot: OrchestrationReadModel,
  scripts: OrchestrationReadModel["projects"][number]["scripts"],
): OrchestrationReadModel {
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) =>
      project.id === PROJECT_ID ? { ...project, scripts: Array.from(scripts) } : project,
    ),
  };
}

function createQueuedTurn(
  overrides: Partial<OrchestrationReadModel["threads"][number]["queuedTurns"][number]> = {},
): OrchestrationReadModel["threads"][number]["queuedTurns"][number] {
  return {
    messageId: "msg-user-queued-1" as MessageId,
    text: "Queued follow-up",
    attachments: [],
    provider: "codex",
    model: "gpt-5",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: "buffered",
    runtimeMode: "full-access",
    interactionMode: "default",
    queuedAt: NOW_ISO,
    ...overrides,
  };
}

function createSnapshotWithLongProposedPlan(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-plan-target" as MessageId,
    targetText: "plan thread",
  });
  const planMarkdown = [
    "# Ship plan mode follow-up",
    "",
    "- Step 1: capture the thread-open trace",
    "- Step 2: identify the main-thread bottleneck",
    "- Step 3: keep collapsed cards cheap",
    "- Step 4: render the full markdown only on demand",
    "- Step 5: preserve export and save actions",
    "- Step 6: add regression coverage",
    "- Step 7: verify route transitions stay responsive",
    "- Step 8: confirm no server-side work changed",
    "- Step 9: confirm short plans still render normally",
    "- Step 10: confirm long plans stay collapsed by default",
    "- Step 11: confirm preview text is still useful",
    "- Step 12: confirm plan follow-up flow still works",
    "- Step 13: confirm timeline virtualization still behaves",
    "- Step 14: confirm theme styling still looks correct",
    "- Step 15: confirm save dialog behavior is unchanged",
    "- Step 16: confirm download behavior is unchanged",
    "- Step 17: confirm code fences do not parse until expand",
    "- Step 18: confirm preview truncation ends cleanly",
    "- Step 19: confirm markdown links still open in editor after expand",
    "- Step 20: confirm deep hidden detail only appears after expand",
    "",
    "```ts",
    "export const hiddenPlanImplementationDetail = 'deep hidden detail only after expand';",
    "```",
  ].join("\n");

  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) =>
      thread.id === THREAD_ID
        ? Object.assign({}, thread, {
            proposedPlans: [
              {
                id: "plan-browser-test",
                turnId: null,
                planMarkdown,
                implementedAt: null,
                implementationThreadId: null,
                createdAt: isoAt(1_000),
                updatedAt: isoAt(1_001),
              },
            ],
            updatedAt: isoAt(1_001),
          })
        : thread,
    ),
  };
}

function createRunningSnapshot(): OrchestrationReadModel {
  const snapshot = createSnapshotForTargetUser({
    targetMessageId: "msg-user-running-target" as MessageId,
    targetText: "running thread",
  });
  const nextThreads = snapshot.threads.slice();
  const firstThread = nextThreads[0];
  if (firstThread?.session) {
    nextThreads[0] = {
      ...firstThread,
      session: {
        ...firstThread.session,
        status: "running",
        activeTurnId: "turn-running" as TurnId,
      },
    };
  }
  return {
    ...snapshot,
    threads: nextThreads,
  };
}

function resolveWsRpc(body: WsRequestEnvelope["body"]): unknown {
  const tag = body._tag;
  const override = wsRpcOverrides.get(tag);
  if (override) {
    return override(body);
  }
  if (tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
        },
      ],
    };
  }
  if (tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: {
        files: [],
        insertions: 0,
        deletions: 0,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (tag === WS_METHODS.projectsSearchEntries) {
    return {
      entries: [],
      truncated: false,
    };
  }
  if (tag === WS_METHODS.skillsSearch) {
    return fixture.skillSearchResult;
  }
  if (tag === WS_METHODS.snippetsList) {
    return fixture.snippetListResult;
  }
  if (tag === WS_METHODS.terminalOpen) {
    return {
      threadId: typeof body.threadId === "string" ? body.threadId : THREAD_ID,
      terminalId: typeof body.terminalId === "string" ? body.terminalId : "default",
      cwd: typeof body.cwd === "string" ? body.cwd : "/repo/project",
      status: "running",
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      updatedAt: NOW_ISO,
    };
  }
  return {};
}

const worker = setupWorker(
  wsLink.addEventListener("connection", ({ client }) => {
    client.send(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverWelcome,
        data: fixture.welcome,
      }),
    );
    client.addEventListener("message", (event) => {
      const rawData = event.data;
      if (typeof rawData !== "string") return;
      let request: WsRequestEnvelope;
      try {
        request = JSON.parse(rawData) as WsRequestEnvelope;
      } catch {
        return;
      }
      const method = request.body?._tag;
      if (typeof method !== "string") return;
      wsRequests.push(request.body);
      if (method === WS_METHODS.snippetsCreate && typeof request.body.text === "string") {
        const trimmedText = request.body.text.trim();
        const existing =
          fixture.snippetListResult.snippets.find((snippet) => snippet.text === trimmedText) ??
          null;
        const nowIso = NOW_ISO;
        const snippet =
          existing ??
          ({
            id: `snippet-${fixture.snippetListResult.snippets.length + 1}` as SnippetId,
            text: trimmedText,
            createdAt: nowIso,
            updatedAt: nowIso,
          } as const);
        fixture = {
          ...fixture,
          snippetListResult: {
            snippets: existing
              ? fixture.snippetListResult.snippets.map((entry) =>
                  entry.id === existing.id ? { ...entry, updatedAt: nowIso } : entry,
                )
              : [{ ...snippet }, ...fixture.snippetListResult.snippets],
          },
        };
        client.send(
          JSON.stringify({
            type: "push",
            sequence: 2,
            channel: WS_CHANNELS.snippetsUpdated,
            data: {
              kind: "upsert",
              snippetId: snippet.id,
              updatedAt: nowIso,
            },
          }),
        );
        client.send(
          JSON.stringify({
            id: request.id,
            result: {
              snippet: existing ? { ...existing, updatedAt: nowIso } : snippet,
              deduped: existing !== null,
            },
          }),
        );
        return;
      }
      if (method === WS_METHODS.snippetsDelete && typeof request.body.snippetId === "string") {
        const snippetId = request.body.snippetId;
        fixture = {
          ...fixture,
          snippetListResult: {
            snippets: fixture.snippetListResult.snippets.filter(
              (snippet) => snippet.id !== snippetId,
            ),
          },
        };
        client.send(
          JSON.stringify({
            type: "push",
            sequence: 2,
            channel: WS_CHANNELS.snippetsUpdated,
            data: {
              kind: "delete",
              snippetId,
              updatedAt: NOW_ISO,
            },
          }),
        );
        client.send(
          JSON.stringify({
            id: request.id,
            result: null,
          }),
        );
        return;
      }
      if (
        method === ORCHESTRATION_WS_METHODS.dispatchCommand &&
        typeof request.body.command === "object" &&
        request.body.command !== null &&
        "type" in request.body.command
      ) {
        const commandType = (request.body.command as { type?: string }).type;
        const errorMessage =
          typeof commandType === "string" ? dispatchCommandErrorsByType.get(commandType) : null;
        if (errorMessage) {
          client.send(
            JSON.stringify({
              id: request.id,
              error: {
                message: errorMessage,
              },
            }),
          );
          return;
        }
      }
      Promise.resolve(resolveWsRpc(request.body))
        .then((result) => {
          client.send(
            JSON.stringify({
              id: request.id,
              result,
            }),
          );
        })
        .catch((error: unknown) => {
          client.send(
            JSON.stringify({
              id: request.id,
              error: {
                message: error instanceof Error ? error.message : "Unexpected RPC error",
              },
            }),
          );
        });
    });
  }),
  http.get("*/attachments/:attachmentId", () =>
    HttpResponse.text(ATTACHMENT_SVG, {
      headers: {
        "Content-Type": "image/svg+xml",
      },
    }),
  ),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function setViewport(viewport: ViewportSpec): Promise<void> {
  await page.viewport(viewport.width, viewport.height);
  await waitForLayout();
}

async function waitForProductionStyles(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
      ).not.toBe("");
      expect(getComputedStyle(document.body).marginTop).toBe("0px");
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );
}

async function waitForElement<T extends Element>(
  query: () => T | null,
  errorMessage: string,
): Promise<T> {
  let element: T | null = null;
  await vi.waitFor(
    () => {
      element = query();
      expect(element, errorMessage).toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );
  if (!element) {
    throw new Error(errorMessage);
  }
  return element;
}

async function waitForURL(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = "";
  await vi.waitFor(
    () => {
      pathname = router.state.location.pathname;
      expect(predicate(pathname), errorMessage).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  return pathname;
}

async function waitForComposerEditor(): Promise<HTMLElement> {
  return waitForElement(
    () => document.querySelector<HTMLElement>('[contenteditable="true"]'),
    "Unable to find composer editor.",
  );
}

async function waitForSendButton(): Promise<HTMLButtonElement> {
  return waitForElement(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Send message"]'),
    "Unable to find send button.",
  );
}

function dispatchSearchAllThreadsShortcut(target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
      ...modShortcutModifiers({ shiftKey: true }),
    }),
  );
}

function dispatchOpenSnippetsShortcut(target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "s",
      bubbles: true,
      cancelable: true,
      ...modShortcutModifiers({ shiftKey: true }),
    }),
  );
}

async function waitForGlobalThreadSearchInput(): Promise<HTMLInputElement> {
  return waitForElement(
    () => document.querySelector<HTMLInputElement>('input[placeholder="Search all threads"]'),
    "Unable to find the global thread search input.",
  );
}

async function waitForSnippetPickerInput(): Promise<HTMLInputElement> {
  return waitForElement(
    () => document.querySelector<HTMLInputElement>('[data-testid="snippet-picker-input"]'),
    "Unable to find the snippet picker input.",
  );
}

async function waitForThreadSearchInput(): Promise<HTMLInputElement> {
  return waitForElement(
    () => document.querySelector<HTMLInputElement>('input[placeholder="Find in thread"]'),
    "Unable to find the in-thread search input.",
  );
}

function listGlobalThreadSearchResults(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-global-thread-search-result="true"]'),
  );
}

function listSnippetPickerResults(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-snippet-picker-result="true"]'));
}
async function waitForQueuedRow(queuedTurnId: string): Promise<HTMLElement> {
  return waitForElement(
    () =>
      document.querySelector<HTMLElement>(`[data-testid="queued-follow-up-row-${queuedTurnId}"]`),
    `Unable to find queued row ${queuedTurnId}.`,
  );
}

function findButtonByText(scope: ParentNode, text: string): HTMLButtonElement | null {
  return (
    (Array.from(scope.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === text,
    ) as HTMLButtonElement | undefined) ?? null
  );
}

function listDispatchCommandsByType(type: string) {
  return wsRequests.filter(
    (request) =>
      request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
      typeof request.command === "object" &&
      request.command !== null &&
      "type" in request.command &&
      (request.command as { type?: string }).type === type,
  ) as Array<{ command?: { type?: string; message?: { text?: string } } }>;
}

async function waitForVisibleNewThreadButtonElement(): Promise<HTMLButtonElement> {
  return waitForElement(
    () =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-testid="new-thread-button"]'),
      ).find((button) => button.offsetParent !== null) ?? null,
    "Unable to find visible new thread button.",
  );
}

async function clickVisibleNewThreadButton(): Promise<void> {
  const newThreadButton = await waitForVisibleNewThreadButtonElement();
  newThreadButton.click();
  await waitForLayout();
}

async function waitForServerConfigToApply(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.some((request) => request._tag === WS_METHODS.serverGetConfig)).toBe(true);
    },
    { timeout: 8_000, interval: 16 },
  );
  await waitForLayout();
}

function dispatchChatNewShortcut(): void {
  const useMetaForMod = isMacPlatform(navigator.platform);
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "o",
      shiftKey: true,
      metaKey: useMetaForMod,
      ctrlKey: !useMetaForMod,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function triggerChatNewShortcutUntilPath(
  router: ReturnType<typeof getRouter>,
  predicate: (pathname: string) => boolean,
  errorMessage: string,
): Promise<string> {
  let pathname = router.state.location.pathname;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    dispatchChatNewShortcut();
    await waitForLayout();
    pathname = router.state.location.pathname;
    if (predicate(pathname)) {
      return pathname;
    }
  }
  throw new Error(`${errorMessage} Last path: ${pathname}`);
}

async function waitForNewThreadShortcutLabel(): Promise<void> {
  const newThreadButton = await waitForVisibleNewThreadButtonElement();
  expect(newThreadButton.getAttribute("aria-label")).toContain("Create new thread");
}

async function waitForImagesToLoad(scope: ParentNode): Promise<void> {
  const images = Array.from(scope.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  await waitForLayout();
}

async function measureUserRow(options: {
  host: HTMLElement;
  targetMessageId: MessageId;
}): Promise<UserRowMeasurement> {
  const { host, targetMessageId } = options;
  const rowSelector = `[data-message-id="${targetMessageId}"][data-message-role="user"]`;

  const scrollContainer = await waitForElement(
    () => host.querySelector<HTMLDivElement>("div.overflow-y-auto.overscroll-y-contain"),
    "Unable to find ChatView message scroll container.",
  );

  let row: HTMLElement | null = null;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await waitForLayout();
      row = host.querySelector<HTMLElement>(rowSelector);
      expect(row, "Unable to locate targeted user message row.").toBeTruthy();
    },
    {
      timeout: 8_000,
      interval: 16,
    },
  );

  await waitForImagesToLoad(row!);
  scrollContainer.scrollTop = 0;
  scrollContainer.dispatchEvent(new Event("scroll"));
  await nextFrame();

  const timelineRoot =
    row!.closest<HTMLElement>('[data-timeline-root="true"]') ??
    host.querySelector<HTMLElement>('[data-timeline-root="true"]');
  if (!(timelineRoot instanceof HTMLElement)) {
    throw new Error("Unable to locate timeline root container.");
  }

  let timelineWidthMeasuredPx = 0;
  let measuredRowHeightPx = 0;
  let renderedInVirtualizedRegion = false;
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll"));
      await nextFrame();
      const measuredRow = host.querySelector<HTMLElement>(rowSelector);
      expect(measuredRow, "Unable to measure targeted user row height.").toBeTruthy();
      timelineWidthMeasuredPx = timelineRoot.getBoundingClientRect().width;
      measuredRowHeightPx = measuredRow!.getBoundingClientRect().height;
      renderedInVirtualizedRegion = measuredRow!.closest("[data-index]") instanceof HTMLElement;
      expect(timelineWidthMeasuredPx, "Unable to measure timeline width.").toBeGreaterThan(0);
      expect(measuredRowHeightPx, "Unable to measure targeted user row height.").toBeGreaterThan(0);
    },
    {
      timeout: 4_000,
      interval: 16,
    },
  );

  return { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion };
}

async function mountChatView(options: {
  viewport: ViewportSpec;
  snapshot: OrchestrationReadModel;
  configureFixture?: (fixture: TestFixture) => void;
}): Promise<MountedChatView> {
  fixture = buildFixture(options.snapshot);
  options.configureFixture?.(fixture);
  await setViewport(options.viewport);
  await waitForProductionStyles();

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(
    createMemoryHistory({
      initialEntries: [`/${THREAD_ID}`],
    }),
  );

  const screen = await render(<RouterProvider router={router} />, {
    container: host,
  });

  await waitForLayout();

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    measureUserRow: async (targetMessageId: MessageId) => measureUserRow({ host, targetMessageId }),
    setViewport: async (viewport: ViewportSpec) => {
      await setViewport(viewport);
      await waitForProductionStyles();
    },
    router,
  };
}

async function measureUserRowAtViewport(options: {
  snapshot: OrchestrationReadModel;
  targetMessageId: MessageId;
  viewport: ViewportSpec;
}): Promise<UserRowMeasurement> {
  const mounted = await mountChatView({
    viewport: options.viewport,
    snapshot: options.snapshot,
  });

  try {
    return await mounted.measureUserRow(options.targetMessageId);
  } finally {
    await mounted.cleanup();
  }
}

describe("ChatView timeline estimator parity (full app)", () => {
  beforeAll(async () => {
    fixture = buildFixture(
      createSnapshotForTargetUser({
        targetMessageId: "msg-user-bootstrap" as MessageId,
        targetText: "bootstrap",
      }),
    );
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: {
        url: "/mockServiceWorker.js",
      },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(async () => {
    await setViewport(DEFAULT_VIEWPORT);
    localStorage.clear();
    document.body.innerHTML = "";
    wsRequests.length = 0;
    dispatchCommandErrorsByType.clear();
    wsRpcOverrides.clear();
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
      queuedTurnsByThreadId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
    useChatToolbarFocusStore.setState({
      branchSelectorFocusRequest: null,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each(TEXT_VIEWPORT_MATRIX)(
    "keeps long user message estimate close at the $name viewport",
    async (viewport) => {
      const userText = "x".repeat(3_200);
      const targetMessageId = `msg-user-target-long-${viewport.name}` as MessageId;
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        const tolerancePx =
          viewport.name === "desktop" ? viewport.textTolerancePx + 80 : viewport.textTolerancePx;
        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(tolerancePx);
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("tracks wrapping parity while resizing an existing ChatView across the viewport matrix", async () => {
    const userText = "x".repeat(3_200);
    const targetMessageId = "msg-user-target-resize" as MessageId;
    const mounted = await mountChatView({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot: createSnapshotForTargetUser({
        targetMessageId,
        targetText: userText,
      }),
    });

    try {
      const measurements: Array<
        UserRowMeasurement & { viewport: ViewportSpec; estimatedHeightPx: number }
      > = [];

      for (const viewport of TEXT_VIEWPORT_MATRIX) {
        await mounted.setViewport(viewport);
        const measurement = await mounted.measureUserRow(targetMessageId);
        const estimatedHeightPx = estimateTimelineMessageHeight(
          { role: "user", text: userText, attachments: [] },
          { timelineWidthPx: measurement.timelineWidthMeasuredPx },
        );

        expect(measurement.renderedInVirtualizedRegion).toBe(true);
        const tolerancePx =
          viewport.name === "desktop" ? viewport.textTolerancePx + 80 : viewport.textTolerancePx;
        expect(Math.abs(measurement.measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          tolerancePx,
        );
        measurements.push({ ...measurement, viewport, estimatedHeightPx });
      }

      expect(
        new Set(measurements.map((measurement) => Math.round(measurement.timelineWidthMeasuredPx)))
          .size,
      ).toBeGreaterThanOrEqual(3);

      const byMeasuredWidth = measurements.toSorted(
        (left, right) => left.timelineWidthMeasuredPx - right.timelineWidthMeasuredPx,
      );
      const narrowest = byMeasuredWidth[0]!;
      const widest = byMeasuredWidth.at(-1)!;
      expect(narrowest.timelineWidthMeasuredPx).toBeLessThan(widest.timelineWidthMeasuredPx);
      expect(narrowest.measuredRowHeightPx).toBeGreaterThan(widest.measuredRowHeightPx);
      expect(narrowest.estimatedHeightPx).toBeGreaterThan(widest.estimatedHeightPx);
    } finally {
      await mounted.cleanup();
    }
  });

  it("tracks additional rendered wrapping when ChatView width narrows between desktop and mobile viewports", async () => {
    const userText = "x".repeat(2_400);
    const targetMessageId = "msg-user-target-wrap" as MessageId;
    const snapshot = createSnapshotForTargetUser({
      targetMessageId,
      targetText: userText,
    });
    const desktopMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[0],
      snapshot,
      targetMessageId,
    });
    const mobileMeasurement = await measureUserRowAtViewport({
      viewport: TEXT_VIEWPORT_MATRIX[2],
      snapshot,
      targetMessageId,
    });

    const estimatedDesktopPx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: desktopMeasurement.timelineWidthMeasuredPx },
    );
    const estimatedMobilePx = estimateTimelineMessageHeight(
      { role: "user", text: userText, attachments: [] },
      { timelineWidthPx: mobileMeasurement.timelineWidthMeasuredPx },
    );

    const measuredDeltaPx =
      mobileMeasurement.measuredRowHeightPx - desktopMeasurement.measuredRowHeightPx;
    const estimatedDeltaPx = estimatedMobilePx - estimatedDesktopPx;
    const widthDeltaPx = Math.abs(
      desktopMeasurement.timelineWidthMeasuredPx - mobileMeasurement.timelineWidthMeasuredPx,
    );
    if (widthDeltaPx < 24) {
      expect(Math.abs(measuredDeltaPx)).toBeLessThanOrEqual(24);
      return;
    }
    expect(measuredDeltaPx).toBeGreaterThan(0);
    expect(estimatedDeltaPx).toBeGreaterThan(0);
    const ratio = estimatedDeltaPx / measuredDeltaPx;
    expect(ratio).toBeGreaterThan(0.65);
    expect(ratio).toBeLessThan(1.35);
  });

  it.each(ATTACHMENT_VIEWPORT_MATRIX)(
    "keeps user attachment estimate close at the $name viewport",
    async (viewport) => {
      const targetMessageId = `msg-user-target-attachments-${viewport.name}` as MessageId;
      const userText = "message with image attachments";
      const mounted = await mountChatView({
        viewport,
        snapshot: createSnapshotForTargetUser({
          targetMessageId,
          targetText: userText,
          targetAttachmentCount: 3,
        }),
      });

      try {
        const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
          await mounted.measureUserRow(targetMessageId);

        expect(renderedInVirtualizedRegion).toBe(true);

        const estimatedHeightPx = estimateTimelineMessageHeight(
          {
            role: "user",
            text: userText,
            attachments: [{ id: "attachment-1" }, { id: "attachment-2" }, { id: "attachment-3" }],
          },
          { timelineWidthPx: timelineWidthMeasuredPx },
        );

        expect(Math.abs(measuredRowHeightPx - estimatedHeightPx)).toBeLessThanOrEqual(
          viewport.attachmentTolerancePx,
        );
      } finally {
        await mounted.cleanup();
      }
    },
  );

  it("opens the project cwd for draft threads without a worktree path", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      queuedTurnsByThreadId: {},
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          availableEditors: ["vscode"],
        };
      },
    });

    try {
      const openButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Open",
          ) as HTMLButtonElement | null,
        "Unable to find Open button.",
      );
      openButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.shellOpenInEditor,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.shellOpenInEditor,
            cwd: "/repo/project",
            editor: "vscode",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from local draft threads at the project cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Lint",
          ) as HTMLButtonElement | null,
        "Unable to find Run Lint button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: THREAD_ID,
            cwd: "/repo/project",
            env: {
              T3CODE_PROJECT_ROOT: "/repo/project",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );

      await vi.waitFor(
        () => {
          const writeRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalWrite,
          );
          expect(writeRequest).toMatchObject({
            _tag: WS_METHODS.terminalWrite,
            threadId: THREAD_ID,
            data: "bun run lint\r",
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("runs project scripts from worktree draft threads at the worktree cwd", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "feature/draft",
          worktreePath: "/repo/worktrees/feature-draft",
          envMode: "worktree",
        },
      },
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: withProjectScripts(createDraftOnlySnapshot(), [
        {
          id: "test",
          name: "Test",
          command: "bun run test",
          icon: "test",
          runOnWorktreeCreate: false,
        },
      ]),
    });

    try {
      const runButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.title === "Run Test",
          ) as HTMLButtonElement | null,
        "Unable to find Run Test button.",
      );
      runButton.click();

      await vi.waitFor(
        () => {
          const openRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalOpen,
          );
          expect(openRequest).toMatchObject({
            _tag: WS_METHODS.terminalOpen,
            threadId: THREAD_ID,
            cwd: "/repo/worktrees/feature-draft",
            env: {
              T3CODE_PROJECT_ROOT: "/repo/project",
              T3CODE_WORKTREE_PATH: "/repo/worktrees/feature-draft",
            },
          });
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles plan mode with Shift+Tab only while the composer is focused", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-hotkey" as MessageId,
        targetText: "hotkey target",
      }),
    });

    try {
      const readInteractionMode = () =>
        useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.interactionMode ?? "default";
      expect(readInteractionMode()).toBe("default");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();

      expect(readInteractionMode()).toBe("default");

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(readInteractionMode()).toBe("plan");
        },
        { timeout: 8_000, interval: 16 },
      );

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(readInteractionMode()).toBe("default");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps removed terminal context pills removed when a new one is added", async () => {
    const removedLabel = "Terminal 1 lines 1-2";
    const addedLabel = "Terminal 2 lines 9-10";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-removed",
        terminalLabel: "Terminal 1",
        lineStart: 1,
        lineEnd: 2,
        text: "bun i\nno changes",
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-terminal-pill-backspace" as MessageId,
        targetText: "terminal pill backspace target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const store = useComposerDraftStore.getState();
      const currentPrompt = store.draftsByThreadId[THREAD_ID]?.prompt ?? "";
      const nextPrompt = removeInlineTerminalContextPlaceholder(currentPrompt, 0);
      store.setPrompt(THREAD_ID, nextPrompt.prompt);
      store.removeTerminalContext(THREAD_ID, "ctx-removed");

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toBeUndefined();
          expect(document.body.textContent).not.toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().addTerminalContext(
        THREAD_ID,
        createTerminalContext({
          id: "ctx-added",
          terminalLabel: "Terminal 2",
          lineStart: 9,
          lineEnd: 10,
          text: "git status\nOn branch main",
        }),
      );

      await vi.waitFor(
        () => {
          const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID];
          expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-added"]);
          expect(document.body.textContent).toContain(addedLabel);
          expect(document.body.textContent).not.toContain(removedLabel);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables send when the composer only contains an expired terminal pill", async () => {
    const expiredLabel = "Terminal 1 line 4";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-expired-only",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "",
      }),
    );

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-expired-pill-disabled" as MessageId,
        targetText: "expired pill disabled target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(expiredLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(true);
    } finally {
      await mounted.cleanup();
    }
  });

  it("warns when sending text while omitting expired terminal pills", async () => {
    const expiredLabel = "Terminal 1 line 4";
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: "ctx-expired-send-warning",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 4,
        text: "",
      }),
    );
    useComposerDraftStore
      .getState()
      .setPrompt(THREAD_ID, `yoo${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}waddup`);

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-expired-pill-warning" as MessageId,
        targetText: "expired pill warning target",
      }),
    });

    try {
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(expiredLabel);
        },
        { timeout: 8_000, interval: 16 },
      );

      const sendButton = await waitForSendButton();
      expect(sendButton.disabled).toBe(false);
      sendButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(
            "Expired terminal context omitted from message",
          );
          expect(document.body.textContent).not.toContain(expiredLabel);
          expect(document.body.textContent).toContain("yoowaddup");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows a pointer cursor for the running stop button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-stop-button-cursor" as MessageId,
        targetText: "stop button cursor target",
        sessionStatus: "running",
      }),
    });

    try {
      const stopButton = await waitForElement(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Stop generation"]'),
        "Unable to find stop generation button.",
      );

      expect(getComputedStyle(stopButton).cursor).toBe("pointer");
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the full skill title readable in autocomplete rows", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-skill-menu" as MessageId,
        targetText: "skill autocomplete target",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.skillSearchResult = {
          skills: [
            {
              name: "canal-pr-finish",
              description:
                "Idempotent end-to-end PR shipping loop for ROKT/canal from any worktree",
              skillPath: "/Users/test/.codex/skills/canal-pr-finish/SKILL.md",
              rootPath: "/Users/test/.codex/skills",
              source: "codex-home",
            },
          ],
          truncated: false,
        };
      },
    });

    try {
      const composerEditor = page.getByTestId("composer-editor");
      await expect.element(composerEditor).toBeVisible();
      await composerEditor.click();
      await composerEditor.fill("$canal-pr");

      await vi.waitFor(
        () => {
          const searchRequests = wsRequests.filter(
            (request) => request._tag === WS_METHODS.skillsSearch,
          );
          expect(searchRequests.length).toBeGreaterThan(0);
        },
        { timeout: 8_000, interval: 16 },
      );

      const skillOption = page.getByText("$canal-pr-finish");
      await expect.element(skillOption).toBeVisible();
      await expect
        .element(
          page.getByText(
            "Codex home · Idempotent end-to-end PR shipping loop for ROKT/canal from any worktree",
          ),
        )
        .toBeVisible();
    } finally {
      await mounted.cleanup();
    }
  });

  it("deletes the current thread when /delete is submitted", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-target-delete" as MessageId,
        targetText: "delete target",
      }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "/delete");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          const closeRequest = wsRequests.find(
            (request) => request._tag === WS_METHODS.terminalClose,
          );
          expect(closeRequest).toMatchObject({
            _tag: WS_METHODS.terminalClose,
            threadId: THREAD_ID,
            deleteHistory: true,
          });
          const deleteRequest = listDispatchCommandsByType("thread.delete").at(-1);
          expect((deleteRequest?.command as { threadId?: string } | undefined)?.threadId).toBe(
            THREAD_ID,
          );
          expect(confirmSpy).toHaveBeenCalledWith(
            'Delete thread "Browser test thread"?\nThis permanently clears conversation history for this thread.',
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      await waitForURL(
        mounted.router,
        (path) => path === "/",
        "Route should navigate home after deleting the last thread.",
      );
    } finally {
      confirmSpy.mockRestore();
      await mounted.cleanup();
    }
  });

  it("keeps the new thread selected after clicking the new-thread button", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-new-thread-test" as MessageId,
        targetText: "new thread selection test",
      }),
    });

    try {
      // Wait for the sidebar to render with the project.
      await waitForVisibleNewThreadButtonElement();

      await clickVisibleNewThreadButton();

      // The route should change to a new draft thread ID.
      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      // The composer editor should be present for the new draft thread.
      await waitForComposerEditor();

      // Simulate the snapshot sync arriving from the server after the draft
      // thread has been promoted to a server thread (thread.create + turn.start
      // succeeded). The snapshot now includes the new thread, and the sync
      // should clear the draft without disrupting the route.
      const { syncServerReadModel } = useStore.getState();
      syncServerReadModel(addThreadToSnapshot(fixture.snapshot, newThreadId));

      // Clear the draft-thread metadata now that the server thread exists
      // (mirrors EventRouter behavior).
      clearPromotedDraftThreads(new Set([newThreadId]));

      // The route should still be on the new thread — not redirected away.
      await waitForURL(
        mounted.router,
        (path) => path === newThreadPath,
        "New thread should remain selected after snapshot sync clears the draft.",
      );

      // The empty thread view and composer should still be visible.
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeInTheDocument();
      await expect.element(page.getByTestId("composer-editor")).toBeInTheDocument();
    } finally {
      await mounted.cleanup();
    }
  });

  it("snapshots sticky codex settings into a new draft thread", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        codex: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "codex",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-codex-traits-test" as MessageId,
        targetText: "sticky codex traits test",
      }),
    });

    try {
      await waitForVisibleNewThreadButtonElement();

      await clickVisibleNewThreadButton();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("hydrates the provider alongside a sticky claude model", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        claudeAgent: {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "max",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "claudeAgent",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-sticky-claude-model-test" as MessageId,
        targetText: "sticky claude model test",
      }),
    });

    try {
      await waitForVisibleNewThreadButtonElement();

      await clickVisibleNewThreadButton();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new sticky claude draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
        modelSelectionByProvider: {
          claudeAgent: {
            provider: "claudeAgent",
            model: "claude-opus-4-6",
            options: {
              effort: "max",
              fastMode: true,
            },
          },
        },
        activeProvider: "claudeAgent",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to defaults when no sticky composer settings exist", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-default-codex-traits-test" as MessageId,
        targetText: "default codex traits test",
      }),
    });

    try {
      await waitForVisibleNewThreadButtonElement();

      await clickVisibleNewThreadButton();

      const newThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID.",
      );
      const newThreadId = newThreadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toBeUndefined();
    } finally {
      await mounted.cleanup();
    }
  });

  it("prefers draft state over sticky composer settings and defaults", async () => {
    useComposerDraftStore.setState({
      stickyModelSelectionByProvider: {
        codex: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            fastMode: true,
          },
        },
      },
      stickyActiveProvider: "codex",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-draft-codex-traits-precedence-test" as MessageId,
        targetText: "draft codex traits precedence test",
      }),
    });

    try {
      await waitForVisibleNewThreadButtonElement();

      await clickVisibleNewThreadButton();

      const threadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a sticky draft thread UUID.",
      );
      const threadId = threadPath.slice(1) as ThreadId;

      expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: {
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });

      useComposerDraftStore.getState().setModelSelection(threadId, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "low",
          fastMode: true,
        },
      });

      await clickVisibleNewThreadButton();

      await waitForURL(
        mounted.router,
        (path) => path === threadPath,
        "New-thread should reuse the existing project draft thread.",
      );
      expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
        modelSelectionByProvider: {
          codex: {
            provider: "codex",
            model: "gpt-5.4",
            options: {
              reasoningEffort: "low",
              fastMode: true,
            },
          },
        },
        activeProvider: "codex",
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("creates a new thread from the global chat.new shortcut", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-chat-shortcut-test" as MessageId,
        targetText: "chat shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForNewThreadShortcutLabel();
      await waitForServerConfigToApply();
      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      await waitForLayout();
      await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a new draft thread UUID from the shortcut.",
      );
    } finally {
      await mounted.cleanup();
    }
  });
  it("creates a fresh draft after the previous draft thread is promoted", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-promoted-draft-shortcut-test" as MessageId,
        targetText: "promoted draft shortcut test",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            {
              command: "chat.new",
              shortcut: {
                key: "o",
                metaKey: false,
                ctrlKey: false,
                shiftKey: true,
                altKey: false,
                modKey: true,
              },
              whenAst: {
                type: "not",
                node: { type: "identifier", name: "terminalFocus" },
              },
            },
          ],
        };
      },
    });

    try {
      await waitForVisibleNewThreadButtonElement();
      await waitForNewThreadShortcutLabel();
      await waitForServerConfigToApply();
      await clickVisibleNewThreadButton();

      const promotedThreadPath = await waitForURL(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path),
        "Route should have changed to a promoted draft thread UUID.",
      );
      const promotedThreadId = promotedThreadPath.slice(1) as ThreadId;

      const { syncServerReadModel } = useStore.getState();
      syncServerReadModel(addThreadToSnapshot(fixture.snapshot, promotedThreadId));
      clearPromotedDraftThreads(new Set([promotedThreadId]));

      const freshThreadPath = await triggerChatNewShortcutUntilPath(
        mounted.router,
        (path) => UUID_ROUTE_RE.test(path) && path !== promotedThreadPath,
        "Shortcut should create a fresh draft instead of reusing the promoted thread.",
      );
      expect(freshThreadPath).not.toBe(promotedThreadPath);
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps long proposed plans lightweight until the user expands them", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotWithLongProposedPlan(),
    });

    try {
      await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Expand plan",
          ) as HTMLButtonElement | null,
        "Unable to find Expand plan button.",
      );

      expect(document.body.textContent).not.toContain("deep hidden detail only after expand");

      const expandButton = await waitForElement(
        () =>
          Array.from(document.querySelectorAll("button")).find(
            (button) => button.textContent?.trim() === "Expand plan",
          ) as HTMLButtonElement | null,
        "Unable to find Expand plan button.",
      );
      expandButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("deep hidden detail only after expand");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("toggles worktree mode with Mod+Shift+W only while the composer is focused", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      queuedTurnsByThreadId: {},
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
    });

    try {
      const initialEnvButton = await waitForElement(
        () => findButtonByText(document, "Local"),
        "Unable to find Local env mode button.",
      );
      expect(initialEnvButton.textContent?.trim()).toBe("Local");
      initialEnvButton.focus();

      initialEnvButton.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "w",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );
      await waitForLayout();

      expect(findButtonByText(document, "New worktree")).toBeNull();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "w",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );

      await waitForElement(
        () => findButtonByText(document, "New worktree"),
        "Unable to find New worktree env mode button.",
      );

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "w",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );

      await waitForElement(
        () => findButtonByText(document, "Local"),
        "Unable to find Local env mode button after toggling back.",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens and focuses the branch/worktree selector with Mod+Shift+E", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      queuedTurnsByThreadId: {},
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture: (nextFixture) => {
        nextFixture.serverConfig = {
          ...nextFixture.serverConfig,
          keybindings: [
            createResolvedKeybinding("e", "chat.branchSelector.focus", {
              shiftKey: true,
              whenAst: whenNot(whenIdentifier("terminalFocus")),
            }),
          ],
        };
      },
    });

    try {
      await waitForServerConfigToApply();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );

      const branchSearchInput = await waitForElement(
        () =>
          document.querySelector(
            'input[placeholder="Search branches..."]',
          ) as HTMLInputElement | null,
        "Unable to find branch search input.",
      );

      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(branchSearchInput);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("does not reopen the branch selector from a stale focus request after remounting", async () => {
    useComposerDraftStore.setState({
      draftThreadsByThreadId: {
        [THREAD_ID]: {
          projectId: PROJECT_ID,
          createdAt: NOW_ISO,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          envMode: "local",
        },
      },
      queuedTurnsByThreadId: {},
      projectDraftThreadIdByProjectId: {
        [PROJECT_ID]: THREAD_ID,
      },
    });

    const configureFixture = (nextFixture: TestFixture) => {
      nextFixture.serverConfig = {
        ...nextFixture.serverConfig,
        keybindings: [
          createResolvedKeybinding("e", "chat.branchSelector.focus", {
            shiftKey: true,
            whenAst: whenNot(whenIdentifier("terminalFocus")),
          }),
        ],
      };
    };

    const firstMount = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture,
    });

    try {
      await waitForServerConfigToApply();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "e",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );

      const branchSearchInput = await waitForElement(
        () =>
          document.querySelector(
            'input[placeholder="Search branches..."]',
          ) as HTMLInputElement | null,
        "Unable to find branch search input.",
      );

      branchSearchInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(document.querySelector('input[placeholder="Search branches..."]')).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await firstMount.cleanup();
    }

    const secondMount = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      configureFixture,
    });

    try {
      await waitForServerConfigToApply();
      await waitForLayout();
      expect(document.querySelector('input[placeholder="Search branches..."]')).toBeNull();
    } finally {
      await secondMount.cleanup();
    }
  });

  it("opens global thread search with mod+shift+f and excludes project metadata and work logs", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(BASE_TIME_MS + 10 * 60_000);
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForGlobalThreadSearch(),
    });

    try {
      dispatchSearchAllThreadsShortcut();
      const input = await waitForGlobalThreadSearchInput();
      expect(document.activeElement).toBe(input);

      await page.getByTestId("global-thread-search-input").fill("needle");
      await vi.waitFor(
        () => {
          const results = listGlobalThreadSearchResults();
          expect(results).toHaveLength(2);
          expect(results[0]?.textContent).toContain("Cross-thread assistant result");
          expect(results[0]?.textContent).toContain("Assistant");
          expect(results[0]?.textContent).toContain("2 matches");
          expect(results[0]?.textContent).toContain("Project");
          expect(results[0]?.textContent).toContain("5 minutes ago");
          const relativeTimestamp = results[0]?.querySelector("[title]");
          expect(relativeTimestamp?.textContent).toBe("5 minutes ago");
          expect(relativeTimestamp?.getAttribute("title")).toBeTruthy();
          expect(
            results.some((result) => result.textContent?.includes("Header Needle Destination")),
          ).toBe(true);
        },
        { timeout: 8_000, interval: 16 },
      );

      await page.getByTestId("global-thread-search-input").fill("Gamma");
      await vi.waitFor(
        () => {
          expect(listGlobalThreadSearchResults()).toHaveLength(0);
          expect(document.body.textContent).toContain("No threads matched this search.");
        },
        { timeout: 8_000, interval: 16 },
      );

      await page.getByTestId("global-thread-search-input").fill("activity-only-needle");
      await vi.waitFor(
        () => {
          expect(listGlobalThreadSearchResults()).toHaveLength(0);
          expect(document.body.textContent).toContain("No threads matched this search.");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      dateNowSpy.mockRestore();
      await mounted.cleanup();
    }
  });

  it("does not open global thread search while terminal focus is active", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForGlobalThreadSearch(),
    });

    const terminalProxy = document.createElement("textarea");
    terminalProxy.className = "xterm-helper-textarea";
    document.body.append(terminalProxy);

    try {
      terminalProxy.focus();
      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(terminalProxy);
        },
        { timeout: 8_000, interval: 16 },
      );
      dispatchSearchAllThreadsShortcut(terminalProxy);
      await waitForLayout();

      expect(document.querySelector('[data-testid="global-thread-search-input"]')).toBeNull();
    } finally {
      terminalProxy.remove();
      await mounted.cleanup();
    }
  });

  it("does not open global thread search while another dialog is already open", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForGlobalThreadSearch(),
    });

    const dialogBlocker = document.createElement("div");
    dialogBlocker.dataset.slot = "dialog-popup";
    document.body.append(dialogBlocker);

    try {
      dispatchSearchAllThreadsShortcut();
      await waitForLayout();

      expect(document.querySelector('[data-testid="global-thread-search-input"]')).toBeNull();
    } finally {
      dialogBlocker.remove();
      await mounted.cleanup();
    }
  });

  it("opens a global content result in the target thread and restores the in-thread match", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForGlobalThreadSearch(),
    });

    try {
      dispatchSearchAllThreadsShortcut();
      const input = await waitForGlobalThreadSearchInput();
      await page.getByTestId("global-thread-search-input").fill("visible global needle");

      await vi.waitFor(
        () => {
          const results = listGlobalThreadSearchResults();
          expect(results).toHaveLength(1);
          expect(results[0]?.textContent).toContain("Cross-thread assistant result");
        },
        { timeout: 8_000, interval: 16 },
      );

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      await waitForURL(
        mounted.router,
        (path) => path === "/thread-global-content",
        "Global content search should navigate to the matching thread.",
      );

      await vi.waitFor(
        () => {
          expect(document.querySelector('[data-testid="global-thread-search-input"]')).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );

      const threadSearchInput = await waitForThreadSearchInput();
      expect(threadSearchInput.value).toBe("visible global needle");

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("1/1");
          const activeRow = document.querySelector<HTMLElement>(
            '[data-thread-search-source-id="msg-assistant-global-content"][data-thread-search-active="true"]',
          );
          expect(activeRow).toBeTruthy();
          expect(activeRow?.textContent).toContain("Visible global needle");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens a global title result and highlights the destination thread title", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForGlobalThreadSearch(),
    });

    try {
      dispatchSearchAllThreadsShortcut();
      await waitForGlobalThreadSearchInput();
      await page.getByTestId("global-thread-search-input").fill("header needle");

      await vi.waitFor(
        () => {
          const results = listGlobalThreadSearchResults();
          expect(results).toHaveLength(1);
          expect(results[0]?.textContent).toContain("Header Needle Destination");
          expect(results[0]?.textContent).toContain("Title");
        },
        { timeout: 8_000, interval: 16 },
      );

      listGlobalThreadSearchResults()[0]?.click();

      await waitForURL(
        mounted.router,
        (path) => path === "/thread-global-title",
        "Global title search should navigate to the title-matching thread.",
      );

      await vi.waitFor(
        () => {
          expect(document.querySelector('input[placeholder="Find in thread"]')).toBeNull();
          const highlightedTitle = document.querySelector("h2 mark");
          expect(highlightedTitle).toBeTruthy();
          expect(document.querySelector("h2")?.textContent).toContain("Header Needle Destination");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("queues with Tab during a running turn by dispatching a server queue command", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Queue this when ready");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          const queueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          expect(queueRequest?.command?.message?.text).toBe("Queue this when ready");
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("queues even while persisting runtime mode for the next turn is still pending", async () => {
    const deferredRuntimeModeUpdate = createDeferred<unknown>();
    wsRpcOverrides.set(ORCHESTRATION_WS_METHODS.dispatchCommand, (body) => {
      const command =
        typeof body.command === "object" && body.command !== null
          ? (body.command as { type?: string })
          : null;
      if (command?.type === "thread.runtime-mode.set") {
        return deferredRuntimeModeUpdate.promise;
      }
      return {};
    });

    const runningSnapshot = createRunningSnapshot();
    const slowRuntimeThreads = runningSnapshot.threads.slice();
    const slowRuntimeThreadIndex = slowRuntimeThreads.findIndex(
      (thread) => thread.id === THREAD_ID,
    );
    const slowRuntimeThread = slowRuntimeThreads[slowRuntimeThreadIndex];
    if (slowRuntimeThread && slowRuntimeThreadIndex >= 0) {
      slowRuntimeThreads[slowRuntimeThreadIndex] = Object.assign({}, slowRuntimeThread, {
        runtimeMode: "approval-required",
        session: slowRuntimeThread.session
          ? {
              ...slowRuntimeThread.session,
              runtimeMode: "approval-required",
            }
          : null,
      });
    }
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: {
        ...runningSnapshot,
        threads: slowRuntimeThreads,
      },
    });

    try {
      useComposerDraftStore.getState().setRuntimeMode(THREAD_ID, "full-access");
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Queue despite slow mode sync");
      await waitForLayout();

      findButtonByText(document, "Queue")?.click();

      await vi.waitFor(
        () => {
          expect(listDispatchCommandsByType("thread.runtime-mode.set")).toHaveLength(1);
          const queueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          expect(queueRequest?.command?.message?.text).toBe("Queue despite slow mode sync");
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "",
          );
          expect(findButtonByText(document, "Queueing...")).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      deferredRuntimeModeUpdate.resolve({});
      await mounted.cleanup();
    }
  });

  it("buffers queued follow-ups locally while a prior queue enqueue is still pending", async () => {
    const deferredQueueEnqueue = createDeferred<unknown>();
    let pendingQueueEnqueueCount = 0;
    wsRpcOverrides.set(ORCHESTRATION_WS_METHODS.dispatchCommand, (body) => {
      const command =
        typeof body.command === "object" && body.command !== null
          ? (body.command as { type?: string })
          : null;
      if (command?.type === "thread.turn.queue.enqueue" && pendingQueueEnqueueCount === 0) {
        pendingQueueEnqueueCount += 1;
        return deferredQueueEnqueue.promise;
      }
      return {};
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "First queued");
      await waitForLayout();

      findButtonByText(document, "Queue")?.click();

      await vi.waitFor(
        () => {
          const queueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          expect(queueRequest?.command?.message?.text).toBe("First queued");
          expect(findButtonByText(document, "Queueing...")).not.toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Second queued");
      await waitForLayout();

      findButtonByText(document, "Queueing...")?.click();

      await vi.waitFor(
        () => {
          const queuedTurns = useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID];
          expect(queuedTurns).toHaveLength(1);
          expect(queuedTurns?.[0]?.text).toBe("Second queued");
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "",
          );
          expect(listDispatchCommandsByType("thread.turn.queue.enqueue")).toHaveLength(1);
        },
        { timeout: 8_000, interval: 16 },
      );

      deferredQueueEnqueue.resolve({});

      await vi.waitFor(
        () => {
          const queueRequests = listDispatchCommandsByType("thread.turn.queue.enqueue");
          const queuedTexts = queueRequests.map((request) => request.command?.message?.text);
          expect(queuedTexts).toEqual(["First queued", "Second queued"]);
          expect(useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID]).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      deferredQueueEnqueue.resolve({});
      await mounted.cleanup();
    }
  });

  it("queues additional messages while preparing a new worktree", async () => {
    const deferredWorktree = createDeferred<{
      worktree: { branch: string; path: string };
    }>();
    wsRpcOverrides.set(WS_METHODS.gitCreateWorktree, () => deferredWorktree.promise);
    useComposerDraftStore.getState().setProjectDraftThreadId(PROJECT_ID, THREAD_ID, {
      createdAt: NOW_ISO,
      branch: "main",
      worktreePath: null,
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Initial worktree message");
      await waitForLayout();

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("Preparing worktree...");
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Queue behind setup");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID]).toHaveLength(1);
          expect(document.body.textContent).toContain("1 queued follow-up");
          expect(listDispatchCommandsByType("thread.turn.queue.enqueue")).toHaveLength(0);
        },
        { timeout: 8_000, interval: 16 },
      );

      deferredWorktree.resolve({
        worktree: {
          branch: "t3code/1234abcd",
          path: "/tmp/t3code-1234abcd",
        },
      });

      await vi.waitFor(
        () => {
          const turnStart = listDispatchCommandsByType("thread.turn.start").at(-1);
          const queuedRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          expect(turnStart?.command?.message?.text).toBe("Initial worktree message");
          expect(queuedRequest?.command?.message?.text).toBe("Queue behind setup");
          expect(useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID]).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("queues next up at the front while preparing a new worktree", async () => {
    const deferredWorktree = createDeferred<{
      worktree: { branch: string; path: string };
    }>();
    wsRpcOverrides.set(WS_METHODS.gitCreateWorktree, () => deferredWorktree.promise);
    useComposerDraftStore.getState().setProjectDraftThreadId(PROJECT_ID, THREAD_ID, {
      createdAt: NOW_ISO,
      branch: "main",
      worktreePath: null,
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Initial worktree message");
      await waitForLayout();

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("Preparing worktree...");
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Queue behind setup");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Put this first");
      await waitForLayout();

      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );

      await vi.waitFor(
        () => {
          const queuedTurns = useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID];
          expect(queuedTurns).toHaveLength(2);
          expect(queuedTurns?.[0]?.text).toBe("Put this first");
          expect(queuedTurns?.[1]?.text).toBe("Queue behind setup");
        },
        { timeout: 8_000, interval: 16 },
      );

      deferredWorktree.resolve({
        worktree: {
          branch: "t3code/1234abcd",
          path: "/tmp/t3code-1234abcd",
        },
      });

      await vi.waitFor(
        () => {
          const queueRequests = listDispatchCommandsByType("thread.turn.queue.enqueue");
          const queuedTexts = queueRequests.map((request) => request.command?.message?.text);
          expect(queuedTexts).toEqual(["Put this first", "Queue behind setup"]);
          expect(useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID]).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the working timer and follow-up actions alive while turn start is still pending", async () => {
    const deferredTurnStart = createDeferred<unknown>();
    let interceptedTurnStart = false;
    wsRpcOverrides.set(ORCHESTRATION_WS_METHODS.dispatchCommand, (body) => {
      const command =
        typeof body.command === "object" && body.command !== null
          ? (body.command as { type?: string })
          : null;
      if (command?.type === "thread.turn.start" && !interceptedTurnStart) {
        interceptedTurnStart = true;
        return deferredTurnStart.promise;
      }
      return {};
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-transient-target" as MessageId,
        targetText: "transient send thread",
      }),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Kick off the next turn");
      await waitForLayout();

      const sendButton = await waitForSendButton();
      sendButton.click();

      await vi.waitFor(
        () => {
          const turnStart = listDispatchCommandsByType("thread.turn.start").at(-1);
          expect(turnStart?.command?.message?.text).toBe("Kick off the next turn");
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Steer during the handoff");
      await waitForLayout();

      await vi.waitFor(
        () => {
          expect(findButtonByText(document, "Steer")).not.toBeNull();
          expect(findButtonByText(document, "Queue")).not.toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );

      await new Promise((resolve) => window.setTimeout(resolve, 1_250));
      await waitForLayout();

      expect(document.body.textContent).toMatch(/Working for [1-9][0-9]*s/);

      findButtonByText(document, "Steer")?.click();

      await vi.waitFor(
        () => {
          const queuedTurns = useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID];
          expect(queuedTurns).toHaveLength(1);
          expect(queuedTurns?.[0]?.text).toBe("Steer during the handoff");
          expect(queuedTurns?.[0]?.disposition).toBe("steer");
        },
        { timeout: 8_000, interval: 16 },
      );

      deferredTurnStart.resolve({});

      await vi.waitFor(
        () => {
          const enqueueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          const sendNowRequest = listDispatchCommandsByType("thread.turn.queue.send-now").at(-1);
          const enqueueCommand = enqueueRequest?.command as
            | { message?: { text?: string; messageId?: string } }
            | undefined;
          const sendNowCommand = sendNowRequest?.command as { messageId?: string } | undefined;
          expect(enqueueCommand?.message?.text).toBe("Steer during the handoff");
          expect(sendNowCommand?.messageId).toBe(enqueueCommand?.message?.messageId);
          expect(useComposerDraftStore.getState().queuedTurnsByThreadId[THREAD_ID]).toBeUndefined();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      deferredTurnStart.resolve({});
      await mounted.cleanup();
    }
  });

  it("steers immediately with mod+enter during a running turn", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Steer this right now");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...steerShortcutModifiers(),
        }),
      );

      await vi.waitFor(
        () => {
          const enqueueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          const sendNowRequest = listDispatchCommandsByType("thread.turn.queue.send-now").at(-1);
          const enqueueCommand = enqueueRequest?.command as
            | { message?: { text?: string; messageId?: string } }
            | undefined;
          const sendNowCommand = sendNowRequest?.command as { messageId?: string } | undefined;
          expect(enqueueCommand?.message?.text).toBe("Steer this right now");
          expect(sendNowCommand?.messageId).toBe(enqueueCommand?.message?.messageId);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("allows queueing again while send-now is still pending", async () => {
    const deferredSendNow = createDeferred<unknown>();
    wsRpcOverrides.set(ORCHESTRATION_WS_METHODS.dispatchCommand, (body) => {
      const command =
        typeof body.command === "object" && body.command !== null
          ? (body.command as { type?: string })
          : null;
      if (command?.type === "thread.turn.queue.send-now") {
        return deferredSendNow.promise;
      }
      return {};
    });

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Steer this right now");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...steerShortcutModifiers(),
        }),
      );

      await vi.waitFor(
        () => {
          const enqueueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          const sendNowRequest = listDispatchCommandsByType("thread.turn.queue.send-now").at(-1);
          const enqueueCommand = enqueueRequest?.command as
            | { message?: { text?: string; messageId?: string } }
            | undefined;
          const sendNowCommand = sendNowRequest?.command as { messageId?: string } | undefined;
          expect(enqueueCommand?.message?.text).toBe("Steer this right now");
          expect(sendNowCommand?.messageId).toBe(enqueueCommand?.message?.messageId);
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "",
          );
        },
        { timeout: 8_000, interval: 16 },
      );

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Queue after steer");
      await waitForLayout();

      findButtonByText(document, "Queue")?.click();

      await vi.waitFor(
        () => {
          const queueRequests = listDispatchCommandsByType("thread.turn.queue.enqueue");
          expect(queueRequests.at(-1)?.command?.message?.text).toBe("Queue after steer");
          expect(findButtonByText(document, "Queueing...")).toBeNull();
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      deferredSendNow.resolve({});
      await mounted.cleanup();
    }
  });

  it("queues next up with mod+shift+enter during a running turn", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      const queuedSnapshot = createRunningSnapshot();
      useStore.getState().syncServerReadModel({
        ...queuedSnapshot,
        threads: [
          {
            ...queuedSnapshot.threads[0]!,
            queuedTurns: [
              createQueuedTurn({
                messageId: "msg-user-queued-head" as MessageId,
                text: "Current next up",
                queuedAt: isoAt(60),
              }),
            ],
          },
        ],
      });

      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Put this next");
      await waitForLayout();

      const composerEditor = await waitForComposerEditor();
      composerEditor.focus();
      composerEditor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          ...modShiftShortcutModifiers(),
        }),
      );

      await vi.waitFor(
        () => {
          const enqueueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          const moveRequest = listDispatchCommandsByType("thread.turn.queue.move").at(-1);
          const enqueueCommand = enqueueRequest?.command as
            | { message?: { text?: string; messageId?: string } }
            | undefined;
          const moveCommand = moveRequest?.command as { messageId?: string } | undefined;
          expect(enqueueCommand?.message?.text).toBe("Put this next");
          expect(moveCommand?.messageId).toBe(enqueueCommand?.message?.messageId);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("steers immediately from the composer button during a running turn", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      useComposerDraftStore.getState().setPrompt(THREAD_ID, "Button steer");
      await waitForLayout();

      findButtonByText(document, "Steer")?.click();

      await vi.waitFor(
        () => {
          const enqueueRequest = listDispatchCommandsByType("thread.turn.queue.enqueue").at(-1);
          const sendNowRequest = listDispatchCommandsByType("thread.turn.queue.send-now").at(-1);
          const enqueueCommand = enqueueRequest?.command as
            | { message?: { text?: string; messageId?: string } }
            | undefined;
          const sendNowCommand = sendNowRequest?.command as { messageId?: string } | undefined;
          expect(enqueueCommand?.message?.text).toBe("Button steer");
          expect(sendNowCommand?.messageId).toBe(enqueueCommand?.message?.messageId);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("renders the queued follow-ups panel and deletes a middle queued turn", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      const queuedSnapshot = createRunningSnapshot();
      const queuedMessageId = "msg-user-queued-b" as MessageId;
      useStore.getState().syncServerReadModel({
        ...queuedSnapshot,
        threads: [
          {
            ...queuedSnapshot.threads[0]!,
            queuedTurns: [
              createQueuedTurn({
                messageId: "msg-user-queued-a" as MessageId,
                text: "First queued",
                queuedAt: isoAt(40),
              }),
              createQueuedTurn({
                messageId: queuedMessageId,
                text: "Second queued",
                queuedAt: isoAt(41),
              }),
              createQueuedTurn({
                messageId: "msg-user-queued-c" as MessageId,
                text: "Third queued",
                queuedAt: isoAt(42),
              }),
            ],
          },
        ],
      });

      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain("3 queued follow-ups");
        },
        { timeout: 8_000, interval: 16 },
      );

      const scrollArea = await waitForElement(
        () => document.querySelector<HTMLElement>('[data-testid="queued-follow-ups-scroll-area"]'),
        "Unable to find the queued follow-ups scroll area.",
      );
      expect(scrollArea.style.maxHeight).toBe("12.5625rem");
      expect(scrollArea.className).toContain("overflow-y-auto");

      const secondRow = await waitForQueuedRow(String(queuedMessageId));
      findButtonByText(secondRow, "Delete")?.click();

      await vi.waitFor(
        () => {
          const removeRequest = listDispatchCommandsByType("thread.turn.queue.remove").at(-1);
          expect((removeRequest?.command as { messageId?: string } | undefined)?.messageId).toBe(
            queuedMessageId,
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("edits a queued follow-up and dispatches queue.update with trimmed text", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      const queuedMessageId = "msg-user-queued-edit" as MessageId;
      const queuedSnapshot = createRunningSnapshot();
      useStore.getState().syncServerReadModel({
        ...queuedSnapshot,
        threads: [
          {
            ...queuedSnapshot.threads[0]!,
            queuedTurns: [
              createQueuedTurn({
                messageId: queuedMessageId,
                text: "Before edit",
                queuedAt: isoAt(50),
              }),
            ],
          },
        ],
      });

      const row = await waitForQueuedRow(String(queuedMessageId));
      findButtonByText(row, "Edit")?.click();

      await expect
        .element(page.getByTestId("queued-follow-up-editor-msg-user-queued-edit"))
        .toBeVisible();
      await page.getByTestId("queued-follow-up-editor-msg-user-queued-edit").fill("  After edit  ");
      findButtonByText(row, "Save")?.click();

      await vi.waitFor(
        () => {
          const updateRequest = listDispatchCommandsByType("thread.turn.queue.update").at(-1);
          expect((updateRequest?.command as { messageId?: string } | undefined)?.messageId).toBe(
            queuedMessageId,
          );
          expect((updateRequest?.command as { text?: string } | undefined)?.text).toBe(
            "After edit",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("sends a queued follow-up now through queue.send-now", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      const queuedSnapshot = createRunningSnapshot();
      const queuedMessageId = "msg-user-queued-send-now" as MessageId;
      useStore.getState().syncServerReadModel({
        ...queuedSnapshot,
        threads: [
          {
            ...queuedSnapshot.threads[0]!,
            queuedTurns: [
              createQueuedTurn({
                messageId: "msg-user-queued-a" as MessageId,
                text: "First queued",
                queuedAt: isoAt(70),
              }),
              createQueuedTurn({
                messageId: queuedMessageId,
                text: "Send this now",
                queuedAt: isoAt(71),
              }),
            ],
          },
        ],
      });

      const row = await waitForQueuedRow(String(queuedMessageId));
      findButtonByText(row, "Send now")?.click();

      await vi.waitFor(
        () => {
          const sendNowRequest = listDispatchCommandsByType("thread.turn.queue.send-now").at(-1);
          expect((sendNowRequest?.command as { messageId?: string } | undefined)?.messageId).toBe(
            queuedMessageId,
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("saves text queued follow-ups as snippets and disables attachment-only rows", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      const queuedSnapshot = createRunningSnapshot();
      const textQueuedTurnId = "msg-user-queued-save-snippet" as MessageId;
      const attachmentOnlyQueuedTurnId = "msg-user-queued-attachment-only" as MessageId;
      useStore.getState().syncServerReadModel({
        ...queuedSnapshot,
        threads: [
          {
            ...queuedSnapshot.threads[0]!,
            queuedTurns: [
              createQueuedTurn({
                messageId: textQueuedTurnId,
                text: "  Save this reusable follow-up  ",
                queuedAt: isoAt(72),
              }),
              createQueuedTurn({
                messageId: attachmentOnlyQueuedTurnId,
                text: "   ",
                attachments: [
                  {
                    type: "image",
                    id: "queued-attachment-only-1",
                    name: "queued-attachment-only-1.png",
                    mimeType: "image/png",
                    sizeBytes: 128,
                  },
                ],
                queuedAt: isoAt(73),
              }),
            ],
          },
        ],
      });

      const saveButton = await waitForElement(
        () =>
          document.querySelector<HTMLButtonElement>(
            '[data-testid="queued-follow-up-save-snippet-msg-user-queued-save-snippet"]',
          ),
        "Unable to find the save-as-snippet button for the text queued follow-up.",
      );
      const attachmentOnlySaveButton = await waitForElement(
        () =>
          document.querySelector<HTMLButtonElement>(
            '[data-testid="queued-follow-up-save-snippet-msg-user-queued-attachment-only"]',
          ),
        "Unable to find the save-as-snippet button for the attachment-only queued follow-up.",
      );

      expect(saveButton.disabled).toBe(false);
      expect(attachmentOnlySaveButton.disabled).toBe(true);

      saveButton.click();

      await vi.waitFor(
        () => {
          const createRequest = wsRequests.find(
            (request) =>
              request._tag === WS_METHODS.snippetsCreate &&
              request.text === "  Save this reusable follow-up  ",
          );
          expect(createRequest).toBeTruthy();
          expect(fixture.snippetListResult.snippets[0]?.text).toBe("Save this reusable follow-up");
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens the snippet picker with mod+shift+s and inserts the highlighted snippet with Enter", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-snippet-picker-open" as MessageId,
        targetText: "snippet picker target",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.snippetListResult = {
          snippets: [
            {
              id: "snippet-1" as SnippetId,
              text: "First saved snippet",
              createdAt: isoAt(91),
              updatedAt: isoAt(91),
            },
            {
              id: "snippet-2" as SnippetId,
              text: "Second saved snippet",
              createdAt: isoAt(90),
              updatedAt: isoAt(90),
            },
          ],
        };
      },
    });

    try {
      dispatchOpenSnippetsShortcut();
      const input = await waitForSnippetPickerInput();
      expect(document.activeElement).toBe(input);
      expect(listSnippetPickerResults()).toHaveLength(2);

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
      await waitForLayout();
      expect(listSnippetPickerResults()[1]?.dataset.highlighted).toBe("true");

      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(document.querySelector('[data-testid="snippet-picker-input"]')).toBeNull();
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "Second saved snippet",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("deletes snippets from the picker dialog", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-snippet-picker-delete" as MessageId,
        targetText: "snippet delete target",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.snippetListResult = {
          snippets: [
            {
              id: "snippet-1" as SnippetId,
              text: "Delete me",
              createdAt: isoAt(92),
              updatedAt: isoAt(92),
            },
          ],
        };
      },
    });

    try {
      dispatchOpenSnippetsShortcut();
      await waitForSnippetPickerInput();

      await page.getByTestId("snippet-picker-delete-snippet-1").click();

      await vi.waitFor(
        () => {
          const deleteRequest = wsRequests.find(
            (request) =>
              request._tag === WS_METHODS.snippetsDelete && request.snippetId === "snippet-1",
          );
          expect(deleteRequest).toBeTruthy();
          expect(listSnippetPickerResults()).toHaveLength(0);
          expect(document.body.textContent).toContain(
            "No saved snippets yet. Heart a queued follow-up to save one.",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("shows snippet matches for %query and replaces the trigger when Enter is pressed", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-snippet-trigger" as MessageId,
        targetText: "snippet trigger target",
      }),
      configureFixture: (nextFixture) => {
        nextFixture.snippetListResult = {
          snippets: [
            {
              id: "snippet-1" as SnippetId,
              text: "Summarize the diff and next steps",
              createdAt: isoAt(93),
              updatedAt: isoAt(93),
            },
          ],
        };
      },
    });

    try {
      const composerEditor = page.getByTestId("composer-editor");
      await expect.element(composerEditor).toBeVisible();
      await composerEditor.click();
      await composerEditor.fill("%Summ");

      await expect.element(page.getByText("Summarize the diff and next steps")).toBeVisible();
      await expect.element(page.getByText("snippet")).toBeVisible();

      const composerEditorElement = await waitForComposerEditor();
      composerEditorElement.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );

      await vi.waitFor(
        () => {
          expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? "").toBe(
            "Summarize the diff and next steps",
          );
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("clears all queued follow-ups via queue.remove", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createRunningSnapshot(),
    });

    try {
      const queuedSnapshot = createRunningSnapshot();
      useStore.getState().syncServerReadModel({
        ...queuedSnapshot,
        threads: [
          {
            ...queuedSnapshot.threads[0]!,
            queuedTurns: [
              createQueuedTurn({
                messageId: "msg-user-queued-a" as MessageId,
                text: "First queued",
                queuedAt: isoAt(80),
              }),
              createQueuedTurn({
                messageId: "msg-user-queued-b" as MessageId,
                text: "Second queued",
                queuedAt: isoAt(81),
              }),
            ],
          },
        ],
      });

      const clearAllButton = await waitForElement(
        () => findButtonByText(document, "Clear all"),
        "Unable to find Clear all button.",
      );
      clearAllButton.click();

      await vi.waitFor(
        () => {
          const removeRequests = listDispatchCommandsByType("thread.turn.queue.remove");
          const messageIds = removeRequests
            .map((request) => (request.command as { messageId?: string } | undefined)?.messageId)
            .filter(Boolean);
          expect(messageIds).toEqual(["msg-user-queued-a", "msg-user-queued-b"]);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the inline diff sidebar provider layout-less while the diff is closed", async () => {
    const mounted = await mountChatView({
      viewport: {
        name: "wide-desktop",
        width: 1440,
        height: 1_100,
        textTolerancePx: 44,
        attachmentTolerancePx: 56,
      },
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-inline-diff-wrapper" as MessageId,
        targetText: "wide desktop thread",
      }),
    });

    try {
      const wrappers = Array.from(
        document.querySelectorAll<HTMLElement>("[data-slot='sidebar-wrapper']"),
      );
      const displays = wrappers.map((wrapper) => getComputedStyle(wrapper).display);

      expect(wrappers).toHaveLength(2);
      expect(displays).toEqual(["flex", "contents"]);
    } finally {
      await mounted.cleanup();
    }
  });

  it("uses the available thread width on wide desktop viewports", async () => {
    const mounted = await mountChatView({
      viewport: {
        name: "wide-desktop",
        width: 1440,
        height: 1_100,
        textTolerancePx: 44,
        attachmentTolerancePx: 56,
      },
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-wide-layout" as MessageId,
        targetText: "wide desktop layout thread",
      }),
    });

    try {
      const timelineRoot = document.querySelector<HTMLElement>("[data-timeline-root='true']");
      expect(timelineRoot).toBeTruthy();
      const scrollContainer = timelineRoot?.parentElement;
      expect(scrollContainer).toBeTruthy();
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      expect(composerForm).toBeTruthy();

      const timelineWidth = timelineRoot!.getBoundingClientRect().width;
      const scrollStyles = getComputedStyle(scrollContainer!);
      const horizontalPadding =
        (Number.parseFloat(scrollStyles.paddingLeft) || 0) +
        (Number.parseFloat(scrollStyles.paddingRight) || 0);
      const availableContentWidth = scrollContainer!.clientWidth - horizontalPadding;
      const composerWidth = composerForm!.getBoundingClientRect().width;

      expect(timelineWidth).toBeGreaterThanOrEqual(availableContentWidth - 8);
      expect(composerWidth).toBeGreaterThanOrEqual(availableContentWidth - 2);
    } finally {
      await mounted.cleanup();
    }
  });
});
