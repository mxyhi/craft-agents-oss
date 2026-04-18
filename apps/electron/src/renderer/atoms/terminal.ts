import { atom } from 'jotai'
import type { TerminalPane, TerminalSession, TerminalSnapshot, TerminalTab } from '../../shared/types'

const MAX_OUTPUT_CACHE_CHARS = 20_000

function createTabId(): string {
  return `terminal_tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function createPaneId(): string {
  return `terminal_pane_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function appendOutput(previous: string | undefined, chunk: string): string {
  const next = `${previous ?? ''}${chunk}`
  if (next.length <= MAX_OUTPUT_CACHE_CHARS) return next
  return next.slice(-MAX_OUTPUT_CACHE_CHARS)
}

function buildDefaultTab(session: TerminalSession, title?: string): TerminalTab {
  return {
    id: createTabId(),
    title: title?.trim() || session.title,
    rootPaneId: createPaneId(),
    activeSessionId: session.id,
    createdAt: Date.now(),
  }
}

function buildDefaultPane(tabId: string, sessionId: string, paneId: string): TerminalPane {
  return {
    id: paneId,
    sessionId,
    tabId,
  }
}

export const terminalSessionsMapAtom = atom<Map<string, TerminalSession>>(new Map())
export const terminalOutputCacheAtom = atom<Map<string, string>>(new Map())
export const terminalTabsAtom = atom<TerminalTab[]>([])
export const terminalPanesAtom = atom<TerminalPane[]>([])
export const terminalDockVisibleAtom = atom<boolean>(false)
export const terminalDockHeightAtom = atom<number>(320)
export const terminalInspectorVisibleAtom = atom<boolean>(true)
export const activeTerminalTabIdAtom = atom<string | null>(null)
export const selectedInspectorSessionIdAtom = atom<string | null>(null)

export const terminalSessionsAtom = atom<TerminalSession[]>((get) => {
  return Array.from(get(terminalSessionsMapAtom).values())
})

function listSessionLaunchConfigs(
  sessions: Map<string, TerminalSession>,
  panes: TerminalPane[],
): TerminalSnapshot['sessionLaunchConfigs'] {
  const sessionIds = new Set<string>()

  return panes.flatMap((pane) => {
    if (sessionIds.has(pane.sessionId)) return []
    sessionIds.add(pane.sessionId)

    const session = sessions.get(pane.sessionId)
    if (!session) return []

    return [{
      sessionId: session.id,
      config: {
        workspaceId: session.workspaceId,
        cwd: session.cwd,
        shell: session.shell,
        title: session.title,
        cols: session.cols,
        rows: session.rows,
      },
    }]
  })
}

export const activeTerminalTabAtom = atom<TerminalTab | null>((get) => {
  const activeTabId = get(activeTerminalTabIdAtom)
  if (!activeTabId) return null
  return get(terminalTabsAtom).find((tab) => tab.id === activeTabId) ?? null
})

export const activeTerminalPaneAtom = atom<TerminalPane | null>((get) => {
  const activeTab = get(activeTerminalTabAtom)
  if (!activeTab) return null
  return get(terminalPanesAtom).find((pane) => pane.tabId === activeTab.id && pane.sessionId === activeTab.activeSessionId) ?? null
})

export const activeTerminalSessionAtom = atom<TerminalSession | null>((get) => {
  const selectedId = get(selectedInspectorSessionIdAtom) ?? get(activeTerminalTabAtom)?.activeSessionId ?? null
  if (!selectedId) return null
  return get(terminalSessionsMapAtom).get(selectedId) ?? null
})

export const activeTerminalOutputAtom = atom<string>((get) => {
  const sessionId = get(activeTerminalSessionAtom)?.id
  if (!sessionId) return ''
  return get(terminalOutputCacheAtom).get(sessionId) ?? ''
})

export const terminalSnapshotAtom = atom<TerminalSnapshot>((get) => {
  const sessions = get(terminalSessionsMapAtom)
  const tabs = get(terminalTabsAtom)
  const panes = get(terminalPanesAtom)

  return {
    dockVisible: get(terminalDockVisibleAtom),
    dockHeight: get(terminalDockHeightAtom),
    inspectorVisible: get(terminalInspectorVisibleAtom),
    activeTabId: get(activeTerminalTabIdAtom) ?? undefined,
    selectedInspectorSessionId: get(selectedInspectorSessionIdAtom) ?? undefined,
    tabs,
    panes,
    sessionLaunchConfigs: listSessionLaunchConfigs(sessions, panes),
  }
})

export const upsertTerminalSessionAtom = atom(
  null,
  (get, set, session: TerminalSession) => {
    const next = new Map(get(terminalSessionsMapAtom))
    next.set(session.id, session)
    set(terminalSessionsMapAtom, next)

    const nextOutput = new Map(get(terminalOutputCacheAtom))
    if (session.lastOutputSummary) {
      nextOutput.set(session.id, appendOutput(nextOutput.get(session.id), session.lastOutputSummary))
      set(terminalOutputCacheAtom, nextOutput)
    }

    const tabs = get(terminalTabsAtom)
    const hasTab = tabs.some((tab) => tab.activeSessionId === session.id)
    if (!hasTab) {
      const newTab = buildDefaultTab(session)
      set(terminalTabsAtom, [...tabs, newTab])
      set(terminalPanesAtom, [...get(terminalPanesAtom), buildDefaultPane(newTab.id, session.id, newTab.rootPaneId)])
      set(activeTerminalTabIdAtom, newTab.id)
    }

    if (!get(selectedInspectorSessionIdAtom)) {
      set(selectedInspectorSessionIdAtom, session.id)
    }
  },
)

export const appendTerminalOutputAtom = atom(
  null,
  (get, set, payload: { sessionId: string; data: string }) => {
    const next = new Map(get(terminalOutputCacheAtom))
    next.set(payload.sessionId, appendOutput(next.get(payload.sessionId), payload.data))
    set(terminalOutputCacheAtom, next)
  },
)

export const replaceTerminalOutputAtom = atom(
  null,
  (get, set, payload: { sessionId: string; output: string }) => {
    const next = new Map(get(terminalOutputCacheAtom))
    next.set(payload.sessionId, payload.output.slice(-MAX_OUTPUT_CACHE_CHARS))
    set(terminalOutputCacheAtom, next)
  },
)

export const setTerminalDockVisibleAtom = atom(
  null,
  (_get, set, visible: boolean) => {
    set(terminalDockVisibleAtom, visible)
  },
)

export const setTerminalDockHeightAtom = atom(
  null,
  (_get, set, height: number) => {
    set(terminalDockHeightAtom, height)
  },
)

export const setTerminalInspectorVisibleAtom = atom(
  null,
  (_get, set, visible: boolean) => {
    set(terminalInspectorVisibleAtom, visible)
  },
)

export const removeTerminalSessionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const nextSessions = new Map(get(terminalSessionsMapAtom))
    nextSessions.delete(sessionId)
    set(terminalSessionsMapAtom, nextSessions)

    const nextOutput = new Map(get(terminalOutputCacheAtom))
    nextOutput.delete(sessionId)
    set(terminalOutputCacheAtom, nextOutput)

    const currentTabs = get(terminalTabsAtom)
    const currentPanes = get(terminalPanesAtom)
    const removedTabIds = currentPanes
      .filter((pane) => pane.sessionId === sessionId)
      .map((pane) => pane.tabId)

    const nextPanes = currentPanes.filter((pane) => pane.sessionId !== sessionId)
    const nextTabs = currentTabs.flatMap((tab) => {
      const panesForTab = nextPanes.filter((pane) => pane.tabId === tab.id)
      if (panesForTab.length === 0) return []

      const nextActiveSessionId = panesForTab.some((pane) => pane.sessionId === tab.activeSessionId)
        ? tab.activeSessionId
        : panesForTab[0].sessionId

      return [{
        ...tab,
        activeSessionId: nextActiveSessionId,
        rootPaneId: panesForTab[0].id,
      }]
    })

    set(terminalTabsAtom, nextTabs)
    set(terminalPanesAtom, nextPanes)

    if (get(selectedInspectorSessionIdAtom) === sessionId) {
      set(selectedInspectorSessionIdAtom, nextTabs.at(-1)?.activeSessionId ?? null)
    }

    const activeTabId = get(activeTerminalTabIdAtom)
    if (activeTabId && removedTabIds.includes(activeTabId)) {
      set(activeTerminalTabIdAtom, nextTabs.at(-1)?.id ?? null)
    }

    if (nextTabs.length === 0) {
      set(terminalDockVisibleAtom, false)
    }
  },
)

export const activateTerminalTabAtom = atom(
  null,
  (_get, set, tabId: string) => {
    set(activeTerminalTabIdAtom, tabId)
  },
)

export const createTerminalTabAtom = atom(
  null,
  (get, set, payload: { session: TerminalSession; title?: string }) => {
    const nextSessions = new Map(get(terminalSessionsMapAtom))
    nextSessions.set(payload.session.id, payload.session)
    set(terminalSessionsMapAtom, nextSessions)

    if (payload.session.lastOutputSummary) {
      const nextOutput = new Map(get(terminalOutputCacheAtom))
      nextOutput.set(
        payload.session.id,
        payload.session.lastOutputSummary.slice(-MAX_OUTPUT_CACHE_CHARS),
      )
      set(terminalOutputCacheAtom, nextOutput)
    }

    const tab = buildDefaultTab(payload.session, payload.title)
    set(terminalTabsAtom, [...get(terminalTabsAtom), tab])
    set(terminalPanesAtom, [...get(terminalPanesAtom), buildDefaultPane(tab.id, payload.session.id, tab.rootPaneId)])
    set(activeTerminalTabIdAtom, tab.id)
    set(selectedInspectorSessionIdAtom, payload.session.id)
    set(terminalDockVisibleAtom, true)
  },
)

export const splitTerminalTabAtom = atom(
  null,
  (get, set, payload: {
    tabId: string
    session: TerminalSession
    direction: TerminalPane['direction']
  }) => {
    const tab = get(terminalTabsAtom).find((item) => item.id === payload.tabId)
    if (!tab) return

    const panes = get(terminalPanesAtom)
    const panesForTab = panes.filter((pane) => pane.tabId === payload.tabId)
    if (panesForTab.length >= 2) return

    const nextSessions = new Map(get(terminalSessionsMapAtom))
    nextSessions.set(payload.session.id, payload.session)
    set(terminalSessionsMapAtom, nextSessions)

    const primaryPane = panesForTab[0]
    if (!primaryPane) return

    const nextPanes = panes.map((pane) => {
      if (pane.id !== primaryPane.id) return pane
      return {
        ...pane,
        direction: payload.direction,
        size: 50,
      }
    })

    nextPanes.push({
      id: createPaneId(),
      sessionId: payload.session.id,
      tabId: payload.tabId,
      splitParentId: primaryPane.id,
      direction: payload.direction,
      size: 50,
    })

    set(terminalPanesAtom, nextPanes)
    set(terminalTabsAtom, get(terminalTabsAtom).map((item) => {
      if (item.id !== payload.tabId) return item
      return {
        ...item,
        activeSessionId: payload.session.id,
      }
    }))
    set(activeTerminalTabIdAtom, payload.tabId)
    set(selectedInspectorSessionIdAtom, payload.session.id)
    set(terminalDockVisibleAtom, true)
  },
)

export const closeTerminalTabAtom = atom(
  null,
  (get, set, tabId: string) => {
    const tabs = get(terminalTabsAtom)
    const closedTab = tabs.find((tab) => tab.id === tabId)
    if (!closedTab) return

    const nextTabs = tabs.filter((tab) => tab.id !== tabId)
    const nextPanes = get(terminalPanesAtom).filter((pane) => pane.tabId !== tabId)
    set(terminalTabsAtom, nextTabs)
    set(terminalPanesAtom, nextPanes)

    const nextActiveTab = nextTabs.at(-1) ?? null
    set(activeTerminalTabIdAtom, nextActiveTab?.id ?? null)
    set(selectedInspectorSessionIdAtom, nextActiveTab?.activeSessionId ?? null)
  },
)

export const activateTerminalSessionAtom = atom(
  null,
  (get, set, payload: { tabId: string; sessionId: string }) => {
    const hasPane = get(terminalPanesAtom).some((pane) => {
      return pane.tabId === payload.tabId && pane.sessionId === payload.sessionId
    })
    if (!hasPane) return

    set(terminalTabsAtom, get(terminalTabsAtom).map((tab) => {
      if (tab.id !== payload.tabId) return tab
      return {
        ...tab,
        activeSessionId: payload.sessionId,
      }
    }))
    set(activeTerminalTabIdAtom, payload.tabId)
    set(selectedInspectorSessionIdAtom, payload.sessionId)
  },
)

export const updateTerminalTabTitleAtom = atom(
  null,
  (get, set, payload: { tabId: string; title: string }) => {
    set(terminalTabsAtom, get(terminalTabsAtom).map((tab) => {
      if (tab.id !== payload.tabId) return tab
      return { ...tab, title: payload.title }
    }))
  },
)

export const syncTerminalTabWithSessionAtom = atom(
  null,
  (get, set, payload: { sessionId: string; title?: string }) => {
    set(terminalTabsAtom, get(terminalTabsAtom).map((tab) => {
      if (tab.activeSessionId !== payload.sessionId) return tab
      return { ...tab, title: payload.title?.trim() || tab.title }
    }))
  },
)

export const hydrateTerminalSnapshotAtom = atom(
  null,
  (_get, set, snapshot: TerminalSnapshot) => {
    set(terminalDockVisibleAtom, snapshot.dockVisible)
    set(terminalDockHeightAtom, snapshot.dockHeight)
    set(terminalInspectorVisibleAtom, snapshot.inspectorVisible)
    set(activeTerminalTabIdAtom, snapshot.activeTabId ?? null)
    set(selectedInspectorSessionIdAtom, snapshot.selectedInspectorSessionId ?? null)
    set(terminalTabsAtom, snapshot.tabs)
    set(terminalPanesAtom, snapshot.panes)
  },
)

export const clearTerminalStateAtom = atom(
  null,
  (_get, set) => {
    set(terminalSessionsMapAtom, new Map())
    set(terminalOutputCacheAtom, new Map())
    set(terminalTabsAtom, [])
    set(terminalPanesAtom, [])
    set(activeTerminalTabIdAtom, null)
    set(selectedInspectorSessionIdAtom, null)
    set(terminalDockVisibleAtom, false)
  },
)
