import "../index.css";

import {
  type CodexImportPeekSessionResult,
  type CodexImportSessionSummary,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationReadModel,
  type ProjectId,
  type ServerConfig,
  type ThreadId,
  type WsWelcomePayload,
  WS_METHODS,
  WS_CHANNELS,
} from "@t3tools/contracts";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { HttpResponse, http, ws } from "msw";
import { setupWorker } from "msw/browser";
import { page } from "vitest/browser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useComposerDraftStore } from "../composerDraftStore";
import { isMacPlatform } from "../lib/utils";
import { getRouter } from "../router";
import { useStore } from "../store";
import { useThreadNavigationHistoryStore } from "../threadNavigationHistoryStore";
import { useThreadSelectionStore } from "../threadSelectionStore";

const NOW_ISO = "2026-03-12T12:00:00.000Z";
const PROJECT_ALPHA_ID = "project-alpha" as ProjectId;
const PROJECT_BETA_ID = "project-beta" as ProjectId;
const THREAD_A8 = "thread-a8" as ThreadId;
const THREAD_A7 = "thread-a7" as ThreadId;
const THREAD_A6 = "thread-a6" as ThreadId;
const THREAD_A5 = "thread-a5" as ThreadId;
const THREAD_A4 = "thread-a4" as ThreadId;
const THREAD_A3 = "thread-a3" as ThreadId;
const THREAD_A2 = "thread-a2" as ThreadId;
const THREAD_A1 = "thread-a1" as ThreadId;
const THREAD_B2 = "thread-b2" as ThreadId;
const THREAD_B1 = "thread-b1" as ThreadId;
const DESKTOP_VIEWPORT = { width: 1280, height: 960 } as const;

interface TestFixture {
  snapshot: OrchestrationReadModel;
  serverConfig: ServerConfig;
  welcome: WsWelcomePayload;
  codexImportSessions: ReadonlyArray<CodexImportSessionSummary>;
}

let fixture: TestFixture;

const wsLink = ws.link(/ws(s)?:\/\/.*/);

function createResolvedKeybinding(
  key: string,
  command: ServerConfig["keybindings"][number]["command"],
  overrides: Partial<ServerConfig["keybindings"][number]["shortcut"]> = {},
) {
  return {
    command,
    shortcut: {
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
      ...overrides,
    },
  } as const;
}

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/alpha",
    keybindingsConfigPath: "/repo/.t3/keybindings.json",
    keybindings: [
      createResolvedKeybinding("[", "sidebar.history.previous"),
      createResolvedKeybinding("]", "sidebar.history.next"),
      createResolvedKeybinding("arrowup", "sidebar.thread.previous", {
        altKey: true,
        modKey: false,
      }),
      createResolvedKeybinding("arrowdown", "sidebar.thread.next", {
        altKey: true,
        modKey: false,
      }),
      createResolvedKeybinding("arrowup", "sidebar.project.previous", {
        altKey: true,
        shiftKey: true,
        modKey: false,
      }),
      createResolvedKeybinding("arrowdown", "sidebar.project.next", {
        altKey: true,
        shiftKey: true,
        modKey: false,
      }),
    ],
    issues: [],
    providers: [
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: NOW_ISO,
      },
    ],
    availableEditors: [],
  };
}

function createThread(options: {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  createdAt: string;
}): OrchestrationReadModel["threads"][number] {
  return {
    id: options.id,
    projectId: options.projectId,
    title: options.title,
    model: "gpt-5",
    interactionMode: "default",
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
    deletedAt: null,
    messages: [],
    queuedTurns: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: {
      threadId: options.id,
      status: "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: options.createdAt,
    },
  };
}

function createSnapshot(): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ALPHA_ID,
        title: "Alpha",
        workspaceRoot: "/repo/alpha",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
      {
        id: PROJECT_BETA_ID,
        title: "Beta",
        workspaceRoot: "/repo/beta",
        defaultModel: "gpt-5",
        scripts: [],
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
        deletedAt: null,
      },
    ],
    threads: [
      createThread({
        id: THREAD_A1,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 1",
        createdAt: "2026-03-12T10:01:00.000Z",
      }),
      createThread({
        id: THREAD_A2,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 2",
        createdAt: "2026-03-12T10:02:00.000Z",
      }),
      createThread({
        id: THREAD_A3,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 3",
        createdAt: "2026-03-12T10:03:00.000Z",
      }),
      createThread({
        id: THREAD_A4,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 4",
        createdAt: "2026-03-12T10:04:00.000Z",
      }),
      createThread({
        id: THREAD_A5,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 5",
        createdAt: "2026-03-12T10:05:00.000Z",
      }),
      createThread({
        id: THREAD_A6,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 6",
        createdAt: "2026-03-12T10:06:00.000Z",
      }),
      createThread({
        id: THREAD_A7,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 7",
        createdAt: "2026-03-12T10:07:00.000Z",
      }),
      createThread({
        id: THREAD_A8,
        projectId: PROJECT_ALPHA_ID,
        title: "Alpha 8",
        createdAt: "2026-03-12T10:08:00.000Z",
      }),
      createThread({
        id: THREAD_B1,
        projectId: PROJECT_BETA_ID,
        title: "Beta 1",
        createdAt: "2026-03-12T11:01:00.000Z",
      }),
      createThread({
        id: THREAD_B2,
        projectId: PROJECT_BETA_ID,
        title: "Beta 2",
        createdAt: "2026-03-12T11:02:00.000Z",
      }),
    ],
    updatedAt: NOW_ISO,
  };
}

function buildFixture(): TestFixture {
  return {
    snapshot: createSnapshot(),
    serverConfig: createBaseServerConfig(),
    welcome: {
      cwd: "/repo/alpha",
      projectName: "Alpha",
      bootstrapProjectId: PROJECT_ALPHA_ID,
      bootstrapThreadId: THREAD_A8,
    },
    codexImportSessions: Array.from({ length: 20 }, (_, index) => {
      const sessionNumber = index + 1;
      const sessionId = `codex-session-${String(sessionNumber).padStart(2, "0")}`;
      return {
        sessionId,
        title: `Codex Session ${String(sessionNumber).padStart(2, "0")}`,
        cwd: `/repo/import-${String(sessionNumber).padStart(2, "0")}`,
        createdAt: `2026-03-12T${String((sessionNumber % 12) + 1).padStart(2, "0")}:00:00.000Z`,
        updatedAt: `2026-03-12T${String((sessionNumber % 12) + 1).padStart(2, "0")}:30:00.000Z`,
        model: "gpt-5",
        kind: "direct",
        transcriptAvailable: true,
        transcriptError: null,
        alreadyImported: false,
        importedThreadId: null,
        lastUserMessage: `User prompt ${String(sessionNumber)}`,
        lastAssistantMessage: `Assistant response ${String(sessionNumber)}`,
      } satisfies CodexImportSessionSummary;
    }),
  };
}

function buildCodexImportPreview(sessionId: string): CodexImportPeekSessionResult {
  const session =
    fixture.codexImportSessions.find((entry) => entry.sessionId === sessionId) ??
    fixture.codexImportSessions[0];

  if (!session) {
    throw new Error("Expected Codex import fixture sessions to exist.");
  }

  return {
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    model: session.model,
    runtimeMode: "full-access",
    interactionMode: "default",
    kind: session.kind,
    transcriptAvailable: session.transcriptAvailable,
    transcriptError: session.transcriptError,
    alreadyImported: session.alreadyImported,
    importedThreadId: session.importedThreadId,
    messages: [
      {
        role: "user",
        text: session.lastUserMessage ?? "User prompt",
        createdAt: session.updatedAt ?? NOW_ISO,
      },
      {
        role: "assistant",
        text: session.lastAssistantMessage ?? "Assistant response",
        createdAt: session.updatedAt ?? NOW_ISO,
      },
    ],
  };
}

function resolveWsRpc(body: { _tag: string; [key: string]: unknown }): unknown {
  if (body._tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
    return fixture.snapshot;
  }
  if (body._tag === WS_METHODS.serverGetConfig) {
    return fixture.serverConfig;
  }
  if (body._tag === WS_METHODS.gitListBranches) {
    return {
      isRepo: true,
      hasOriginRemote: true,
      branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    };
  }
  if (body._tag === WS_METHODS.gitStatus) {
    return {
      branch: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    };
  }
  if (body._tag === WS_METHODS.projectsSearchEntries) {
    return { entries: [], truncated: false };
  }
  if (body._tag === WS_METHODS.codexImportListSessions) {
    return fixture.codexImportSessions;
  }
  if (body._tag === WS_METHODS.codexImportPeekSession) {
    return buildCodexImportPreview(String(body.sessionId ?? ""));
  }
  if (body._tag === WS_METHODS.codexImportImportSessions) {
    return { results: [] };
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
      if (typeof event.data !== "string") return;
      let request: { id: string; body: { _tag: string; [key: string]: unknown } };
      try {
        request = JSON.parse(event.data);
      } catch {
        return;
      }
      const method = request.body?._tag;
      if (typeof method !== "string") return;
      client.send(
        JSON.stringify({
          id: request.id,
          result: resolveWsRpc(request.body),
        }),
      );
    });
  }),
  http.get("*/api/project-favicon", () => new HttpResponse(null, { status: 204 })),
);

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForLayout(): Promise<void> {
  await nextFrame();
  await nextFrame();
  await nextFrame();
}

async function setViewport(): Promise<void> {
  await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  await waitForLayout();
}

function shortcutModifiers(): Pick<KeyboardEventInit, "ctrlKey" | "metaKey"> {
  return isMacPlatform(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
}

function dispatchSidebarShortcut(
  init: { key: string; altKey?: boolean; shiftKey?: boolean },
  target: EventTarget = window,
): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: init.key,
      altKey: init.altKey ?? false,
      shiftKey: init.shiftKey ?? false,
      bubbles: true,
      cancelable: true,
      ...(init.altKey || init.shiftKey ? {} : shortcutModifiers()),
    }),
  );
}

async function waitForPath(router: ReturnType<typeof getRouter>, pathname: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(router.state.location.pathname).toBe(pathname);
    },
    { timeout: 8_000, interval: 16 },
  );
}

async function waitForSidebarThread(title: string): Promise<HTMLElement> {
  let element: HTMLElement | null = null;
  await vi.waitFor(
    () => {
      element =
        Array.from(document.querySelectorAll<HTMLElement>("[data-thread-item]")).find((node) =>
          node.textContent?.includes(title),
        ) ?? null;
      expect(element, `Expected sidebar thread "${title}" to render`).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  return element!;
}

async function waitForButton(label: string): Promise<HTMLElement> {
  let element: HTMLElement | null = null;
  await vi.waitFor(
    () => {
      element =
        Array.from(document.querySelectorAll<HTMLElement>("button")).find((node) =>
          node.textContent?.includes(label),
        ) ?? null;
      expect(element, `Expected control "${label}" to render`).toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  return element!;
}

async function waitForComposerEditor(): Promise<HTMLElement> {
  let element: HTMLElement | null = null;
  await vi.waitFor(
    () => {
      element = document.querySelector<HTMLElement>('[data-testid="composer-editor"]');
      expect(element, "Expected composer editor to render").toBeTruthy();
    },
    { timeout: 8_000, interval: 16 },
  );
  return element!;
}

async function mountApp(initialEntry: string): Promise<{
  cleanup: () => Promise<void>;
  router: ReturnType<typeof getRouter>;
}> {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.width = "100vw";
  host.style.height = "100vh";
  host.style.display = "grid";
  host.style.overflow = "hidden";
  document.body.append(host);

  const router = getRouter(createMemoryHistory({ initialEntries: [initialEntry] }));
  const screen = await render(<RouterProvider router={router} />, { container: host });
  await waitForLayout();

  await waitForSidebarThread("Alpha 5");

  return {
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
    router,
  };
}

describe("Sidebar navigation keybindings", () => {
  beforeAll(async () => {
    fixture = buildFixture();
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(async () => {
    fixture = buildFixture();
    await setViewport();
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      queuedTurnsByThreadId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
    useThreadNavigationHistoryStore.getState().clearHistory();
    useThreadSelectionStore.getState().clearSelection();
  });

  it("navigates down the visible sidebar thread list with alt+down", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_A4}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("navigates up the visible sidebar thread list with alt+up", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      dispatchSidebarShortcut({ key: "ArrowUp", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_A6}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the first visible thread when there is no active thread", async () => {
    const mounted = await mountApp("/settings");

    try {
      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_A8}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("falls back to the last visible thread when there is no active thread", async () => {
    const mounted = await mountApp("/settings");

    try {
      dispatchSidebarShortcut({ key: "ArrowUp", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_B1}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("skips threads hidden behind Show more until expanded", async () => {
    const mounted = await mountApp(`/${THREAD_A3}`);

    try {
      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_B2}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("includes hidden threads after Show more is expanded", async () => {
    const mounted = await mountApp(`/${THREAD_A3}`);

    try {
      const showMoreButton = await waitForButton("Show more");
      showMoreButton.click();
      await waitForButton("Show less");
      await waitForSidebarThread("Alpha 2");

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_A2}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("jumps between projects with alt+shift+up/down", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true, shiftKey: true });
      await waitForPath(mounted.router, `/${THREAD_B2}`);

      dispatchSidebarShortcut({ key: "ArrowUp", altKey: true, shiftKey: true });
      await waitForPath(mounted.router, `/${THREAD_A8}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("expands the destination project when project navigation targets a collapsed project", async () => {
    const mounted = await mountApp(`/${THREAD_A8}`);

    try {
      const betaProjectButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button"),
      ).find((node) => node.textContent?.includes("Beta"));
      expect(betaProjectButton).toBeTruthy();
      betaProjectButton?.click();
      await waitForLayout();

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true, shiftKey: true });
      await waitForPath(mounted.router, `/${THREAD_B2}`);
      await waitForSidebarThread("Beta 2");
    } finally {
      await mounted.cleanup();
    }
  });

  it("navigates through chat selection history with mod+[ and mod+]", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_A4}`);

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true, shiftKey: true });
      await waitForPath(mounted.router, `/${THREAD_B2}`);

      dispatchSidebarShortcut({ key: "[" });
      await waitForPath(mounted.router, `/${THREAD_A4}`);

      dispatchSidebarShortcut({ key: "[" });
      await waitForPath(mounted.router, `/${THREAD_A5}`);

      dispatchSidebarShortcut({ key: "]" });
      await waitForPath(mounted.router, `/${THREAD_A4}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("clears multi-selection and updates the anchor when keyboard navigation succeeds", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      const selectionStore = useThreadSelectionStore.getState();
      selectionStore.toggleThread(THREAD_A5);
      selectionStore.toggleThread(THREAD_A4);
      await waitForLayout();

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true });
      await waitForPath(mounted.router, `/${THREAD_A4}`);

      const state = useThreadSelectionStore.getState();
      expect(state.selectedThreadIds.size).toBe(0);
      expect(state.anchorThreadId).toBe(THREAD_A4);
    } finally {
      await mounted.cleanup();
    }
  });

  it("ignores the shortcut while a sidebar text input is focused", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      const addProjectButton = document.querySelector<HTMLElement>(
        'button[aria-label="Add project"]',
      );
      expect(addProjectButton).toBeTruthy();
      addProjectButton?.click();

      let input: HTMLInputElement | null = null;
      await vi.waitFor(
        () => {
          input = document.querySelector<HTMLInputElement>('input[placeholder="/path/to/project"]');
          expect(input).toBeTruthy();
        },
        { timeout: 8_000, interval: 16 },
      );
      const addProjectInput = document.querySelector<HTMLInputElement>(
        'input[placeholder="/path/to/project"]',
      );
      if (!addProjectInput) {
        throw new Error("Expected add-project input to render");
      }
      addProjectInput.focus();

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true }, addProjectInput);
      await new Promise((resolve) => window.setTimeout(resolve, 150));

      expect(mounted.router.state.location.pathname).toBe(`/${THREAD_A5}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("continues sidebar thread navigation while the composer contenteditable is focused", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      let composerEditor = await waitForComposerEditor();
      composerEditor.focus();

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true }, composerEditor);
      await waitForPath(mounted.router, `/${THREAD_A4}`);

      composerEditor = await waitForComposerEditor();
      composerEditor.focus();

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true }, composerEditor);
      await waitForPath(mounted.router, `/${THREAD_A3}`);
    } finally {
      await mounted.cleanup();
    }
  });

  it("continues history navigation while the composer contenteditable is focused", async () => {
    const mounted = await mountApp(`/${THREAD_A5}`);

    try {
      let composerEditor = await waitForComposerEditor();
      composerEditor.focus();

      dispatchSidebarShortcut({ key: "ArrowDown", altKey: true }, composerEditor);
      await waitForPath(mounted.router, `/${THREAD_A4}`);

      composerEditor = await waitForComposerEditor();
      composerEditor.focus();

      dispatchSidebarShortcut({ key: "[" }, composerEditor);
      await waitForPath(mounted.router, `/${THREAD_A5}`);
    } finally {
      await mounted.cleanup();
    }
  });
});

describe("Import From Codex dialog", () => {
  beforeAll(async () => {
    fixture = buildFixture();
    await worker.start({
      onUnhandledRequest: "bypass",
      quiet: true,
      serviceWorker: { url: "/mockServiceWorker.js" },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  beforeEach(async () => {
    fixture = buildFixture();
    await setViewport();
    localStorage.clear();
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      queuedTurnsByThreadId: {},
    });
    useStore.setState({
      projects: [],
      threads: [],
      threadsHydrated: false,
    });
    useThreadNavigationHistoryStore.getState().clearHistory();
    useThreadSelectionStore.getState().clearSelection();
  });

  it("lets the left session column overflow and scroll through long result sets", async () => {
    const mounted = await mountApp(`/${THREAD_A8}`);

    try {
      const importButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Import from Codex"]',
      );
      expect(importButton, "Expected import button to render").toBeTruthy();
      importButton?.click();

      let dialogTitle: HTMLElement | null = null;
      await vi.waitFor(
        () => {
          dialogTitle =
            Array.from(document.querySelectorAll<HTMLElement>("h2")).find((node) =>
              node.textContent?.includes("Import From Codex"),
            ) ?? null;
          expect(dialogTitle).toBeTruthy();
        },
        { timeout: 8_000, interval: 16 },
      );

      let listViewport: HTMLElement | null = null;
      await vi.waitFor(
        () => {
          listViewport = document.querySelector<HTMLElement>(
            '[data-testid="codex-import-session-list"] [data-slot="scroll-area-viewport"]',
          );
          expect(listViewport, "Expected left import list viewport to render").toBeTruthy();
          expect(listViewport!.scrollHeight).toBeGreaterThan(listViewport!.clientHeight);
        },
        { timeout: 8_000, interval: 16 },
      );

      const initialScrollTop = listViewport!.scrollTop;
      listViewport!.scrollTop = 600;
      listViewport!.dispatchEvent(new Event("scroll"));
      await waitForLayout();

      expect(listViewport!.scrollTop).toBeGreaterThan(initialScrollTop);
    } finally {
      await mounted.cleanup();
    }
  });
});
