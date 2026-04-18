import { describe, expect, it } from 'bun:test'
import type { TerminalSession, TerminalSnapshot } from '../../../shared/types'
import {
  createEmptyTerminalSnapshot,
  DEFAULT_TERMINAL_DOCK_HEIGHT,
  getTerminalSnapshotSignature,
  resolveTerminalLayoutStorageScope,
  shouldRestoreTerminalSnapshot,
} from '../terminal-layout'

function makeSession(id: string): TerminalSession {
  return {
    id,
    workspaceId: 'ws-1',
    cwd: '/tmp/project',
    shell: '/bin/bash',
    title: 'Terminal',
    status: 'running',
    cols: 120,
    rows: 36,
    restored: false,
    createdAt: 1,
    lastActiveAt: 1,
  }
}

function makeSnapshot(overrides: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    ...createEmptyTerminalSnapshot(),
    ...overrides,
  }
}

describe('terminal layout helpers', () => {
  it('creates an empty terminal snapshot with stable defaults', () => {
    expect(createEmptyTerminalSnapshot()).toEqual({
      dockVisible: false,
      dockHeight: DEFAULT_TERMINAL_DOCK_HEIGHT,
      inspectorVisible: true,
      tabs: [],
      panes: [],
      sessionLaunchConfigs: [],
    })
  })

  it('prefers workspace slug for storage scope and falls back to workspace id', () => {
    expect(resolveTerminalLayoutStorageScope('demo', 'ws-1')).toBe('demo')
    expect(resolveTerminalLayoutStorageScope(null, 'ws-1')).toBe('ws-1')
    expect(resolveTerminalLayoutStorageScope(null, null)).toBeNull()
  })

  it('restores snapshot only when no live sessions exist and launch configs are available', () => {
    const snapshot = makeSnapshot({
      sessionLaunchConfigs: [{
        sessionId: 'terminal-1',
        config: {
          workspaceId: 'ws-1',
          cwd: '/tmp/project',
        },
      }],
    })

    expect(shouldRestoreTerminalSnapshot(snapshot, [])).toBe(true)
    expect(shouldRestoreTerminalSnapshot(snapshot, [makeSession('terminal-1')])).toBe(false)
    expect(shouldRestoreTerminalSnapshot(makeSnapshot(), [])).toBe(false)
  })

  it('produces a stable signature for persistence dedupe', () => {
    const snapshot = makeSnapshot({
      dockVisible: true,
      activeTabId: 'tab-1',
    })

    expect(getTerminalSnapshotSignature(snapshot)).toBe(JSON.stringify(snapshot))
  })
})
