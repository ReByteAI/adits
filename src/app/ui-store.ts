import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Small UI-only store, persisted to localStorage.
 *
 * This is split out from the main `store.ts` on purpose: that store owns
 * server-derived state (projects, tasks, files) and must never hit
 * localStorage. This one holds only ephemeral UI preferences that we want
 * to survive reloads — sidebar collapse state, and a hidden debug-view bit
 * (mirrors CC2's `rebyte-debug-view` atom) that reveals superuser UI.
 */
export const CHAT_WIDTH_MIN = 220
export const CHAT_WIDTH_MAX = 600
export const CHAT_WIDTH_DEFAULT = 280

interface UiStore {
  /** Desktop sidebar collapse. Distinct from store.ts's `sidebarOpen`,
   *  which drives the mobile drawer. Toggled by Ctrl/Cmd+B. */
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (value: boolean) => void

  /** Width (px) of the Workspace V2 chat sidebar. Persisted so the
   *  user's drag settles across reloads. Clamped on write. */
  chatWidth: number
  setChatWidth: (value: number) => void

  /** Hidden debug panel flag. When true, a top-right Nav button appears
   *  that opens a flat list of every task across every project. Flipped
   *  by 7-clicking the logo (matching CC2's trick) or via the console
   *  helper `window.__aditsDebug.enable()`. */
  debugViewEnabled: boolean
  toggleDebugView: () => void
  setDebugView: (value: boolean) => void
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),

      chatWidth: CHAT_WIDTH_DEFAULT,
      setChatWidth: (value) =>
        set({ chatWidth: Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, Math.round(value))) }),

      debugViewEnabled: false,
      toggleDebugView: () =>
        set((s) => ({ debugViewEnabled: !s.debugViewEnabled })),
      setDebugView: (value) => set({ debugViewEnabled: value }),
    }),
    {
      name: 'adits-ui',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

// Selectors
export const useSidebarCollapsed = () => useUiStore((s) => s.sidebarCollapsed)
export const useChatWidth = () => useUiStore((s) => s.chatWidth)
export const useDebugViewEnabled = () => useUiStore((s) => s.debugViewEnabled)

// Console helper so devs can flip the debug bit without the 7-click gesture.
if (typeof window !== 'undefined') {
  ;(window as any).__aditsDebug = {
    enable: () => useUiStore.getState().setDebugView(true),
    disable: () => useUiStore.getState().setDebugView(false),
    toggle: () => useUiStore.getState().toggleDebugView(),
  }
}
