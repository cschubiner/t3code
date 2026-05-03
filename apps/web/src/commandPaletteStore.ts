import { create } from "zustand";

interface CommandPaletteOpenIntent {
  kind: "add-project" | "project-search" | "thread-search";
  requestId: number;
}

interface CommandPaletteStore {
  open: boolean;
  openIntent: CommandPaletteOpenIntent | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  openAddProject: () => void;
  openProjectSearch: () => void;
  openThreadSearch: () => void;
  clearOpenIntent: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  openIntent: null,
  setOpen: (open) => set({ open, ...(open ? {} : { openIntent: null }) }),
  toggleOpen: () =>
    set((state) => ({ open: !state.open, ...(state.open ? { openIntent: null } : {}) })),
  openAddProject: () =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "add-project",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
      },
    })),
  openProjectSearch: () =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "project-search",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
      },
    })),
  openThreadSearch: () =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "thread-search",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
      },
    })),
  clearOpenIntent: () => set({ openIntent: null }),
}));
