import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopRemoteAccessStatus } from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const REMOTE_ACCESS_STATUS_CHANNEL = "desktop:remote-access-status";
const REMOTE_ACCESS_GET_STATUS_CHANNEL = "desktop:remote-access-get-status";
const REMOTE_ACCESS_SET_ENABLED_CHANNEL = "desktop:remote-access-set-enabled";

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => {
    const result = ipcRenderer.sendSync(GET_WS_URL_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  getRemoteAccessStatus: () => ipcRenderer.invoke(REMOTE_ACCESS_GET_STATUS_CHANNEL),
  setRemoteAccessEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(REMOTE_ACCESS_SET_ENABLED_CHANNEL, enabled),
  onRemoteAccessStatus: (listener: (status: DesktopRemoteAccessStatus) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, status: unknown) => {
      if (typeof status !== "object" || status === null) return;
      listener(status as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(REMOTE_ACCESS_STATUS_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(REMOTE_ACCESS_STATUS_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
