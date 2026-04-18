import type { TerminalSession, TerminalSnapshot } from '../../shared/types'

export const DEFAULT_TERMINAL_DOCK_HEIGHT = 320

export function createEmptyTerminalSnapshot(): TerminalSnapshot {
  return {
    dockVisible: false,
    dockHeight: DEFAULT_TERMINAL_DOCK_HEIGHT,
    inspectorVisible: true,
    tabs: [],
    panes: [],
    sessionLaunchConfigs: [],
  }
}

export function resolveTerminalLayoutStorageScope(
  workspaceSlug: string | null,
  workspaceId: string | null,
): string | null {
  return workspaceSlug ?? workspaceId ?? null
}

export function shouldRestoreTerminalSnapshot(
  snapshot: TerminalSnapshot,
  liveSessions: TerminalSession[],
): boolean {
  return liveSessions.length === 0 && snapshot.sessionLaunchConfigs.length > 0
}

export function getTerminalSnapshotSignature(snapshot: TerminalSnapshot): string {
  return JSON.stringify(snapshot)
}
