import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  type DesktopBridge,
  EventId,
  SnippetId,
  type SnippetLibraryUpdatedPayload,
  ProjectId,
  type OrchestrationEvent,
  type ServerConfig,
  type ServerProvider,
  type TerminalEvent,
  ThreadId,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "@t3tools/contracts";

const showContextMenuFallbackMock =
  vi.fn<
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>
  >();

function registerListener<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const terminalEventListeners = new Set<(event: TerminalEvent) => void>();
const orchestrationEventListeners = new Set<(event: OrchestrationEvent) => void>();
const snippetUpdatedListeners = new Set<(event: SnippetLibraryUpdatedPayload) => void>();

const rpcClientMock = {
  dispose: vi.fn(),
  terminal: {
    open: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    restart: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn((listener: (event: TerminalEvent) => void) =>
      registerListener(terminalEventListeners, listener),
    ),
  },
  projects: {
    searchEntries: vi.fn(),
    writeFile: vi.fn(),
  },
  skills: {
    search: vi.fn(),
  },
  snippets: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    onUpdated: vi.fn((listener: (event: SnippetLibraryUpdatedPayload) => void) =>
      registerListener(snippetUpdatedListeners, listener),
    ),
  },
  codexImport: {
    listSessions: vi.fn(),
    peekSession: vi.fn(),
    importSessions: vi.fn(),
  },
  shell: {
    openInEditor: vi.fn(),
  },
  git: {
    pull: vi.fn(),
    status: vi.fn(),
    runStackedAction: vi.fn(),
    listBranches: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    createBranch: vi.fn(),
    checkout: vi.fn(),
    init: vi.fn(),
    resolvePullRequest: vi.fn(),
    preparePullRequestThread: vi.fn(),
  },
  server: {
    getConfig: vi.fn(),
    refreshProviders: vi.fn(),
    upsertKeybinding: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    subscribeConfig: vi.fn(),
    subscribeLifecycle: vi.fn(),
  },
  orchestration: {
    getSnapshot: vi.fn(),
    dispatchCommand: vi.fn(),
    getTurnDiff: vi.fn(),
    getFullThreadDiff: vi.fn(),
    replayEvents: vi.fn(),
    onDomainEvent: vi.fn((listener: (event: OrchestrationEvent) => void) =>
      registerListener(orchestrationEventListeners, listener),
    ),
  },
};

vi.mock("./wsRpcClient", () => {
  return {
    getWsRpcClient: () => rpcClientMock,
    __resetWsRpcClientForTests: vi.fn(),
  };
});

vi.mock("./contextMenuFallback", () => ({
  showContextMenuFallback: showContextMenuFallbackMock,
}));

function emitEvent<T>(listeners: Set<(event: T) => void>, event: T) {
  for (const listener of listeners) {
    listener(event);
  }
}

function getWindowForTest(): Window & typeof globalThis & { desktopBridge?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { desktopBridge?: unknown };
  };
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { desktopBridge?: unknown };
  }
  return testGlobal.window;
}

function makeDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    getWsUrl: () => null,
    pickFolder: async () => null,
    confirm: async () => true,
    setTheme: async () => undefined,
    showContextMenu: async () => null,
    openExternal: async () => true,
    onMenuAction: () => () => undefined,
    getUpdateState: async () => {
      throw new Error("getUpdateState not implemented in test");
    },
    checkForUpdate: async () => {
      throw new Error("checkForUpdate not implemented in test");
    },
    downloadUpdate: async () => {
      throw new Error("downloadUpdate not implemented in test");
    },
    installUpdate: async () => {
      throw new Error("installUpdate not implemented in test");
    },
    onUpdateState: () => () => undefined,
    getRemoteAccessStatus: async () => ({
      enabled: false,
      state: "disabled",
      provider: "tailscale",
      preferredUrl: null,
      urls: [],
      message: null,
    }),
    setRemoteAccessEnabled: async () => ({
      enabled: false,
      state: "disabled",
      provider: "tailscale",
      preferredUrl: null,
      urls: [],
      message: null,
    }),
    onRemoteAccessStatus: () => () => undefined,
    ...overrides,
  };
}

const defaultProviders: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
  },
];

const baseServerConfig: ServerConfig = {
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/.config/keybindings.json",
  keybindings: [],
  issues: [],
  providers: defaultProviders,
  availableEditors: ["cursor"],
  settings: DEFAULT_SERVER_SETTINGS,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  showContextMenuFallbackMock.mockReset();
  terminalEventListeners.clear();
  orchestrationEventListeners.clear();
  snippetUpdatedListeners.clear();
  Reflect.deleteProperty(getWindowForTest(), "desktopBridge");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsNativeApi", () => {
  it("forwards server config fetches directly to the RPC client", async () => {
    rpcClientMock.server.getConfig.mockResolvedValue(baseServerConfig);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();

    await expect(api.server.getConfig()).resolves.toEqual(baseServerConfig);
    expect(rpcClientMock.server.getConfig).toHaveBeenCalledWith();
    expect(rpcClientMock.server.subscribeConfig).not.toHaveBeenCalled();
    expect(rpcClientMock.server.subscribeLifecycle).not.toHaveBeenCalled();
  });

  it("forwards skill search directly to the RPC client", async () => {
    const searchResult = {
      skills: [
        {
          name: "agent-browser",
          description: "Browser automation skill",
          skillPath: "/Users/test/.codex/skills/agent-browser/SKILL.md",
          rootPath: "/Users/test/.codex/skills",
          source: "codex-home" as const,
        },
      ],
      truncated: false,
    };
    rpcClientMock.skills.search.mockResolvedValue(searchResult);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();

    await expect(
      api.skills.search({
        cwd: "/repo",
        query: "agent",
        limit: 40,
        codexHomePath: "/Users/test/.codex",
      }),
    ).resolves.toEqual(searchResult);
    expect(rpcClientMock.skills.search).toHaveBeenCalledWith({
      cwd: "/repo",
      query: "agent",
      limit: 40,
      codexHomePath: "/Users/test/.codex",
    });
  });

  it("forwards snippet RPC and update subscriptions", async () => {
    const listResult = {
      snippets: [
        {
          id: SnippetId.makeUnsafe("snippet-1"),
          text: "Saved snippet",
          createdAt: "2026-03-16T12:00:00.000Z",
          updatedAt: "2026-03-16T12:00:00.000Z",
        },
      ],
    };
    const createResult = {
      snippet: listResult.snippets[0],
      deduped: false,
    };
    rpcClientMock.snippets.list.mockResolvedValue(listResult);
    rpcClientMock.snippets.create.mockResolvedValue(createResult);
    rpcClientMock.snippets.delete.mockResolvedValue(undefined);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const onUpdated = vi.fn();
    const unsubscribe = api.snippets.onUpdated(onUpdated);

    await expect(api.snippets.list()).resolves.toEqual(listResult);
    await expect(api.snippets.create({ text: "Saved snippet" })).resolves.toEqual(createResult);
    await expect(
      api.snippets.delete({ snippetId: SnippetId.makeUnsafe("snippet-1") }),
    ).resolves.toBeUndefined();

    emitEvent(snippetUpdatedListeners, {
      kind: "upsert",
      snippetId: SnippetId.makeUnsafe("snippet-1"),
      updatedAt: "2026-03-16T12:00:00.000Z",
    });
    expect(onUpdated).toHaveBeenCalledWith({
      kind: "upsert",
      snippetId: SnippetId.makeUnsafe("snippet-1"),
      updatedAt: "2026-03-16T12:00:00.000Z",
    });

    unsubscribe();
  });

  it("forwards codex import RPC directly to the RPC client", async () => {
    const listResult = [
      {
        sessionId: "session-1",
        title: "Imported session",
        cwd: "/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:10:00.000Z",
        model: "gpt-5-codex",
        kind: "direct" as const,
        transcriptAvailable: true,
        transcriptError: null,
        alreadyImported: false,
        importedThreadId: null,
        lastUserMessage: "hello",
        lastAssistantMessage: "hi",
      },
    ] as const;
    const peekResult = {
      sessionId: "session-1",
      title: "Imported session",
      cwd: "/repo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:10:00.000Z",
      model: "gpt-5-codex",
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      kind: "direct" as const,
      transcriptAvailable: true,
      transcriptError: null,
      alreadyImported: false,
      importedThreadId: null,
      messages: [],
    };
    const importResult = {
      results: [
        {
          sessionId: "session-1",
          status: "imported" as const,
          threadId: ThreadId.makeUnsafe("thread-imported"),
          projectId: ProjectId.makeUnsafe("project-imported"),
          error: null,
        },
      ],
    };

    rpcClientMock.codexImport.listSessions.mockResolvedValue(listResult);
    rpcClientMock.codexImport.peekSession.mockResolvedValue(peekResult);
    rpcClientMock.codexImport.importSessions.mockResolvedValue(importResult);

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();

    await expect(
      api.codexImport.listSessions({ kind: "direct", limit: 5, query: "import" }),
    ).resolves.toEqual(listResult);
    await expect(
      api.codexImport.peekSession({ sessionId: "session-1", messageCount: 3 }),
    ).resolves.toEqual(peekResult);
    await expect(api.codexImport.importSessions({ sessionIds: ["session-1"] })).resolves.toEqual(
      importResult,
    );

    expect(rpcClientMock.codexImport.listSessions).toHaveBeenCalledWith({
      kind: "direct",
      limit: 5,
      query: "import",
    });
    expect(rpcClientMock.codexImport.peekSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      messageCount: 3,
    });
    expect(rpcClientMock.codexImport.importSessions).toHaveBeenCalledWith({
      sessionIds: ["session-1"],
    });
  });

  it("forwards terminal and orchestration stream events", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const onTerminalEvent = vi.fn();
    const onDomainEvent = vi.fn();

    api.terminal.onEvent(onTerminalEvent);
    api.orchestration.onDomainEvent(onDomainEvent);

    const terminalEvent = {
      threadId: "thread-1",
      terminalId: "terminal-1",
      createdAt: "2026-02-24T00:00:00.000Z",
      type: "output",
      data: "hello",
    } as const;
    emitEvent(terminalEventListeners, terminalEvent);

    const orchestrationEvent = {
      sequence: 1,
      eventId: EventId.makeUnsafe("event-1"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("project-1"),
      occurredAt: "2026-02-24T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/workspace",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
    } satisfies Extract<OrchestrationEvent, { type: "project.created" }>;
    emitEvent(orchestrationEventListeners, orchestrationEvent);

    expect(onTerminalEvent).toHaveBeenCalledWith(terminalEvent);
    expect(onDomainEvent).toHaveBeenCalledWith(orchestrationEvent);
  });

  it("sends orchestration dispatch commands as the direct RPC payload", async () => {
    rpcClientMock.orchestration.dispatchCommand.mockResolvedValue({ sequence: 1 });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const command = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(command);

    expect(rpcClientMock.orchestration.dispatchCommand).toHaveBeenCalledWith(command);
  });

  it("forwards workspace file writes to the project RPC", async () => {
    rpcClientMock.projects.writeFile.mockResolvedValue({ relativePath: "plan.md" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.writeFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });

    expect(rpcClientMock.projects.writeFile).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });
  });

  it("forwards full-thread diff requests to the orchestration RPC", async () => {
    rpcClientMock.orchestration.getFullThreadDiff.mockResolvedValue({ diff: "patch" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.orchestration.getFullThreadDiff({
      threadId: ThreadId.makeUnsafe("thread-1"),
      toTurnCount: 1,
    });

    expect(rpcClientMock.orchestration.getFullThreadDiff).toHaveBeenCalledWith({
      threadId: "thread-1",
      toTurnCount: 1,
    });
  });

  it("forwards provider refreshes directly to the RPC client", async () => {
    const nextProviders: ReadonlyArray<ServerProvider> = [
      {
        ...defaultProviders[0]!,
        checkedAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    rpcClientMock.server.refreshProviders.mockResolvedValue({ providers: nextProviders });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();

    await expect(api.server.refreshProviders()).resolves.toEqual({ providers: nextProviders });
    expect(rpcClientMock.server.refreshProviders).toHaveBeenCalledWith();
  });

  it("updates the cached server config when provider refreshes resolve", async () => {
    const nextProviders: ReadonlyArray<ServerProvider> = [
      {
        ...defaultProviders[0]!,
        status: "warning",
        checkedAt: "2026-01-03T00:00:00.000Z",
        message: "temporary issue",
      },
    ];
    rpcClientMock.server.refreshProviders.mockResolvedValue({ providers: nextProviders });
    const serverState = await import("./rpc/serverState");
    serverState.setServerConfigSnapshot(baseServerConfig);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();

    await api.server.refreshProviders();

    expect(serverState.getServerConfig()).toEqual({
      ...baseServerConfig,
      providers: nextProviders,
    });
  });

  it("forwards server settings updates directly to the RPC client", async () => {
    const nextSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    };
    rpcClientMock.server.updateSettings.mockResolvedValue(nextSettings);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();

    await expect(api.server.updateSettings({ enableAssistantStreaming: true })).resolves.toEqual(
      nextSettings,
    );
    expect(rpcClientMock.server.updateSettings).toHaveBeenCalledWith({
      enableAssistantStreaming: true,
    });
  });

  it("forwards context menu metadata to the desktop bridge", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("delete");
    getWindowForTest().desktopBridge = makeDesktopBridge({ showContextMenu });

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    const items = [{ id: "delete", label: "Delete" }] as const;

    await expect(api.contextMenu.show(items)).resolves.toBe("delete");
    expect(showContextMenu).toHaveBeenCalledWith(items, undefined);
  });

  it("falls back to the browser context menu helper when the desktop bridge is missing", async () => {
    showContextMenuFallbackMock.mockResolvedValue("rename");
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const items = [{ id: "rename", label: "Rename" }] as const;

    await expect(api.contextMenu.show(items, { x: 4, y: 5 })).resolves.toBe("rename");
    expect(showContextMenuFallbackMock).toHaveBeenCalledWith(items, { x: 4, y: 5 });
  });
});
