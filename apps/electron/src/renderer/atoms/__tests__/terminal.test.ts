import { describe, expect, it } from 'bun:test'
import { createStore } from 'jotai'
import type { TerminalSession, TerminalSnapshot } from '../../../shared/types'
import {
  activeTerminalSessionAtom,
  activeTerminalTabAtom,
  activeTerminalTabIdAtom,
  appendTerminalOutputAtom,
  closeTerminalTabAtom,
  createTerminalTabAtom,
  hydrateTerminalSnapshotAtom,
  removeTerminalSessionAtom,
  replaceTerminalOutputAtom,
  selectedInspectorSessionIdAtom,
  splitTerminalTabAtom,
  terminalDockHeightAtom,
  terminalDockVisibleAtom,
  terminalInspectorVisibleAtom,
  terminalPanesAtom,
  terminalSnapshotAtom,
  terminalSessionsAtom,
  terminalTabsAtom,
  activeTerminalOutputAtom,
  upsertTerminalSessionAtom,
} from '../terminal'

function makeSession(id: string): TerminalSession {
  return {
    id,
    workspaceId: 'ws-1',
    cwd: '/tmp/project',
    shell: '/bin/bash',
    title: id,
    status: 'running',
    cols: 120,
    rows: 36,
    restored: false,
    createdAt: 1,
    lastActiveAt: 1,
  }
}

describe('terminal atoms', () => {
  it('upserts and removes terminal sessions', () => {
    const store = createStore()

    store.set(upsertTerminalSessionAtom, makeSession('terminal-1'))
    store.set(upsertTerminalSessionAtom, makeSession('terminal-2'))

    expect(store.get(terminalSessionsAtom).map((session) => session.id)).toEqual([
      'terminal-1',
      'terminal-2',
    ])

    store.set(selectedInspectorSessionIdAtom, 'terminal-1')
    expect(store.get(activeTerminalSessionAtom)?.id).toBe('terminal-1')

    store.set(removeTerminalSessionAtom, 'terminal-1')

    expect(store.get(terminalSessionsAtom).map((session) => session.id)).toEqual(['terminal-2'])
    expect(store.get(selectedInspectorSessionIdAtom)).toBe('terminal-2')
  })

  it('hydrates dock, tabs, panes, and inspector selection from snapshot', () => {
    const store = createStore()
    const snapshot: TerminalSnapshot = {
      dockVisible: true,
      dockHeight: 420,
      inspectorVisible: false,
      activeTabId: 'tab-1',
      selectedInspectorSessionId: 'terminal-2',
      tabs: [
        {
          id: 'tab-1',
          title: 'Main',
          rootPaneId: 'pane-1',
          activeSessionId: 'terminal-1',
          createdAt: 1,
        },
      ],
      panes: [
        {
          id: 'pane-1',
          sessionId: 'terminal-1',
          tabId: 'tab-1',
        },
      ],
      sessionLaunchConfigs: [],
    }

    store.set(hydrateTerminalSnapshotAtom, snapshot)

    expect(store.get(terminalDockVisibleAtom)).toBe(true)
    expect(store.get(terminalDockHeightAtom)).toBe(420)
    expect(store.get(terminalInspectorVisibleAtom)).toBe(false)
    expect(store.get(activeTerminalTabIdAtom)).toBe('tab-1')
    expect(store.get(selectedInspectorSessionIdAtom)).toBe('terminal-2')
    expect(store.get(terminalTabsAtom)).toEqual(snapshot.tabs)
    expect(store.get(terminalPanesAtom)).toEqual(snapshot.panes)
  })

  it('tracks output cache and derives a restorable snapshot', () => {
    const store = createStore()
    store.set(createTerminalTabAtom, { session: makeSession('terminal-1'), title: 'Main' })

    store.set(appendTerminalOutputAtom, { sessionId: 'terminal-1', data: 'hello\n' })
    store.set(appendTerminalOutputAtom, { sessionId: 'terminal-1', data: 'world\n' })

    expect(store.get(activeTerminalOutputAtom)).toBe('hello\nworld\n')

    const snapshot = store.get(terminalSnapshotAtom)
    expect(snapshot.dockVisible).toBe(true)
    expect(snapshot.tabs).toHaveLength(1)
    expect(snapshot.sessionLaunchConfigs).toEqual([
      {
        sessionId: 'terminal-1',
        config: {
          workspaceId: 'ws-1',
          cwd: '/tmp/project',
          shell: '/bin/bash',
          title: 'terminal-1',
          cols: 120,
          rows: 36,
        },
      },
    ])
  })

  it('creates and closes tabs while preserving active selection', () => {
    const store = createStore()
    store.set(createTerminalTabAtom, { session: makeSession('terminal-1'), title: 'One' })
    store.set(createTerminalTabAtom, { session: makeSession('terminal-2'), title: 'Two' })

    const tabs = store.get(terminalTabsAtom)
    expect(tabs).toHaveLength(2)
    expect(store.get(activeTerminalTabAtom)?.title).toBe('Two')

    store.set(closeTerminalTabAtom, tabs[1].id)

    expect(store.get(terminalTabsAtom)).toHaveLength(1)
    expect(store.get(activeTerminalTabAtom)?.title).toBe('One')
  })

  it('splits the active tab into two panes and keeps remaining pane when one session closes', () => {
    const store = createStore()
    const left = makeSession('terminal-1')
    const right = makeSession('terminal-2')

    store.set(createTerminalTabAtom, { session: left, title: 'Main' })
    const [tab] = store.get(terminalTabsAtom)

    store.set(splitTerminalTabAtom, {
      tabId: tab.id,
      session: right,
      direction: 'vertical',
    })

    expect(store.get(terminalPanesAtom)).toHaveLength(2)
    expect(store.get(activeTerminalTabAtom)?.activeSessionId).toBe('terminal-2')

    store.set(removeTerminalSessionAtom, 'terminal-2')

    expect(store.get(terminalTabsAtom)).toHaveLength(1)
    expect(store.get(terminalPanesAtom)).toHaveLength(1)
    expect(store.get(activeTerminalTabAtom)?.activeSessionId).toBe('terminal-1')
    expect(store.get(selectedInspectorSessionIdAtom)).toBe('terminal-1')
  })

  it('replaces persisted output cache for restored terminals', () => {
    const store = createStore()
    store.set(createTerminalTabAtom, { session: makeSession('terminal-1') })

    store.set(replaceTerminalOutputAtom, { sessionId: 'terminal-1', output: 'restored\nbuffer\n' })

    expect(store.get(activeTerminalOutputAtom)).toBe('restored\nbuffer\n')
  })
})
