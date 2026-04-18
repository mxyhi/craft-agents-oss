import * as React from 'react'
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Copy,
  FolderOpen,
  PanelBottomClose,
  PanelRight,
  Plus,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { HorizontalResizeHandle } from '@/components/ui/horizontal-resize-handle'
import { Button } from '@/components/ui/button'
import {
  activateTerminalSessionAtom,
  activateTerminalTabAtom,
  activeTerminalSessionAtom,
  activeTerminalTabAtom,
  removeTerminalSessionAtom,
  replaceTerminalOutputAtom,
  setTerminalDockHeightAtom,
  setTerminalDockVisibleAtom,
  setTerminalInspectorVisibleAtom,
  terminalDockHeightAtom,
  terminalDockVisibleAtom,
  terminalInspectorVisibleAtom,
  terminalOutputCacheAtom,
  terminalPanesAtom,
  terminalSessionsMapAtom,
  terminalTabsAtom,
} from '@/atoms/terminal'
import type { TerminalSession, TerminalSplitDirection } from '../../../shared/types'
import { TerminalPaneView } from './TerminalPaneView'

interface TerminalDockProps {
  defaultCwd: string | null
  onCreateTerminal: (payload: {
    cwd?: string
    title?: string
    splitTabId?: string
    direction?: TerminalSplitDirection
  }) => Promise<TerminalSession | null>
}

const MIN_DOCK_HEIGHT = 220
const MAX_DOCK_HEIGHT = 720
const INSPECTOR_WIDTH = 300

function statusTone(status: TerminalSession['status']): string {
  switch (status) {
    case 'running':
      return 'bg-emerald-500'
    case 'starting':
    case 'restoring':
      return 'bg-amber-400'
    case 'exited':
      return 'bg-slate-400'
    case 'killed':
      return 'bg-rose-500'
    case 'failed':
      return 'bg-red-600'
  }
}

export function TerminalDock({ defaultCwd, onCreateTerminal }: TerminalDockProps) {
  const tabs = useAtomValue(terminalTabsAtom)
  const panes = useAtomValue(terminalPanesAtom)
  const sessionsMap = useAtomValue(terminalSessionsMapAtom)
  const outputCache = useAtomValue(terminalOutputCacheAtom)
  const dockVisible = useAtomValue(terminalDockVisibleAtom)
  const dockHeight = useAtomValue(terminalDockHeightAtom)
  const inspectorVisible = useAtomValue(terminalInspectorVisibleAtom)
  const activeTab = useAtomValue(activeTerminalTabAtom)
  const activeSession = useAtomValue(activeTerminalSessionAtom)

  const activateTab = useSetAtom(activateTerminalTabAtom)
  const activateTerminalSession = useSetAtom(activateTerminalSessionAtom)
  const removeTerminalSession = useSetAtom(removeTerminalSessionAtom)
  const replaceTerminalOutput = useSetAtom(replaceTerminalOutputAtom)
  const setDockHeight = useSetAtom(setTerminalDockHeightAtom)
  const setDockVisible = useSetAtom(setTerminalDockVisibleAtom)
  const setInspectorVisible = useSetAtom(setTerminalInspectorVisibleAtom)

  const activePanes = React.useMemo(() => {
    if (!activeTab) return []
    return panes.filter((pane) => pane.tabId === activeTab.id)
  }, [activeTab, panes])
  const activeTabId = activeTab?.id ?? null

  const handleResizeDock = React.useCallback((deltaY: number) => {
    setDockHeight(Math.max(MIN_DOCK_HEIGHT, Math.min(MAX_DOCK_HEIGHT, dockHeight - deltaY)))
  }, [dockHeight, setDockHeight])

  const handleNewTerminal = React.useCallback(() => {
    void onCreateTerminal({ cwd: defaultCwd ?? undefined, title: defaultCwd ?? 'Terminal' })
  }, [defaultCwd, onCreateTerminal])

  const handleSplitTerminal = React.useCallback((direction: TerminalSplitDirection) => {
    if (!activeTab) return
    void onCreateTerminal({
      cwd: activeSession?.cwd ?? defaultCwd ?? undefined,
      title: activeSession?.title ?? 'Split Terminal',
      splitTabId: activeTab.id,
      direction,
    })
  }, [activeSession?.cwd, activeSession?.title, activeTab, defaultCwd, onCreateTerminal])

  const handleCloseSession = React.useCallback(async (session: TerminalSession) => {
    if (session.status === 'exited' || session.status === 'killed' || session.status === 'failed') {
      removeTerminalSession(session.id)
      return
    }
    await window.electronAPI.closeTerminal(session.id)
  }, [removeTerminalSession])

  const handleKillSession = React.useCallback(async (session: TerminalSession) => {
    await window.electronAPI.killTerminal(session.id)
  }, [])

  const handleClearSession = React.useCallback(async (session: TerminalSession) => {
    await window.electronAPI.clearTerminalScrollback(session.id)
    replaceTerminalOutput({ sessionId: session.id, output: '' })
  }, [replaceTerminalOutput])

  const handleCopyCwd = React.useCallback(async (session: TerminalSession) => {
    await navigator.clipboard.writeText(session.cwd)
  }, [])

  const handleRevealCwd = React.useCallback((session: TerminalSession) => {
    void window.electronAPI.showInFolder(session.cwd)
  }, [])

  if (!dockVisible) {
    return (
      <div className="border-t border-border/70 bg-background/95 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-[10px] border border-border/70 bg-background px-3 py-1.5 text-sm text-foreground/70 shadow-minimal"
            onClick={() => {
              if (tabs.length > 0) {
                setDockVisible(true)
                return
              }
              handleNewTerminal()
            }}
          >
            <ChevronUp className="h-4 w-4" />
            {tabs.length > 0 ? 'Terminal' : 'Open Terminal'}
            {tabs.length > 0 && (
              <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-xs text-foreground/55">
                {tabs.length}
              </span>
            )}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-border/70 bg-background/95">
      <HorizontalResizeHandle onResize={handleResizeDock} />

      <div className="flex min-h-0 flex-col" style={{ height: dockHeight }}>
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            {tabs.map((tab) => {
              const tabSession = sessionsMap.get(tab.activeSessionId)
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => activateTab(tab.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-sm shadow-minimal transition-colors',
                    activeTab?.id === tab.id
                      ? 'border-foreground/20 bg-foreground/8 text-foreground'
                      : 'border-border/70 bg-background text-foreground/60 hover:text-foreground',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', tabSession ? statusTone(tabSession.status) : 'bg-slate-300')} />
                  <span className="truncate">{tab.title}</span>
                </button>
              )
            })}

            {tabs.length === 0 && (
              <span className="text-sm text-foreground/50">No terminal yet</span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleNewTerminal}>
              <Plus className="h-4 w-4" />
              New
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => handleSplitTerminal('vertical')} disabled={!activeTab || activePanes.length >= 2}>
              <Columns2 className="h-4 w-4" />
              Split
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setInspectorVisible(!inspectorVisible)}>
              <PanelRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => setDockVisible(false)}>
              <PanelBottomClose className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 gap-3 p-3">
            {activePanes.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-[14px] border border-dashed border-border/70 bg-background/70 text-sm text-foreground/50">
                Create a terminal to start working.
              </div>
            ) : activePanes.length === 1 ? (
              (() => {
                const pane = activePanes[0]
                const session = sessionsMap.get(pane.sessionId)
                if (!session) return null
                return (
                  <TerminalPaneView
                    key={pane.id}
                    session={session}
                    output={outputCache.get(session.id) ?? ''}
                    active={activeTab?.activeSessionId === session.id}
                    onActivate={() => {
                      if (!activeTabId) return
                      activateTerminalSession({ tabId: activeTabId, sessionId: session.id })
                    }}
                  />
                )
              })()
            ) : (
              <div
                className={cn(
                  'flex min-h-0 flex-1 gap-3',
                  (activePanes[0]?.direction ?? activePanes[1]?.direction) === 'horizontal'
                    ? 'flex-col'
                    : 'flex-row',
                )}
              >
                {activePanes.map((pane) => {
                  const session = sessionsMap.get(pane.sessionId)
                  if (!session) return null
                  return (
                    <div key={pane.id} className="min-h-0 min-w-0 flex-1">
                      <TerminalPaneView
                        session={session}
                        output={outputCache.get(session.id) ?? ''}
                        active={activeTab?.activeSessionId === session.id}
                        onActivate={() => {
                          if (!activeTabId) return
                          activateTerminalSession({ tabId: activeTabId, sessionId: session.id })
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {inspectorVisible && (
            <aside
              className="flex shrink-0 flex-col border-l border-border/70 bg-background/80 p-3"
              style={{ width: INSPECTOR_WIDTH }}
            >
              {activeSession ? (
                <>
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-foreground/45">Inspector</div>
                    <div className="text-base font-medium text-foreground">{activeSession.title}</div>
                    <div className="rounded-[12px] border border-border/70 bg-background px-3 py-2 text-sm text-foreground/65">
                      <div className="mb-2 flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 rounded-full', statusTone(activeSession.status))} />
                        <span>{activeSession.status}</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div>cwd: {activeSession.cwd}</div>
                        <div>shell: {activeSession.shell}</div>
                        <div>size: {activeSession.cols} x {activeSession.rows}</div>
                        {typeof activeSession.pid === 'number' && <div>pid: {activeSession.pid}</div>}
                        {typeof activeSession.exitCode === 'number' && <div>exit: {activeSession.exitCode}</div>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleClearSession(activeSession)}>
                      <RotateCcw className="h-4 w-4" />
                      Clear
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyCwd(activeSession)}>
                      <Copy className="h-4 w-4" />
                      Copy cwd
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleRevealCwd(activeSession)}>
                      <FolderOpen className="h-4 w-4" />
                      Reveal
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => handleSplitTerminal('horizontal')} disabled={!activeTab || activePanes.length >= 2}>
                      <Columns2 className="h-4 w-4" />
                      Split
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleKillSession(activeSession)} disabled={activeSession.status === 'exited' || activeSession.status === 'killed' || activeSession.status === 'failed'}>
                      <Square className="h-4 w-4" />
                      Kill
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCloseSession(activeSession)}>
                      <Trash2 className="h-4 w-4" />
                      {activeSession.status === 'exited' || activeSession.status === 'killed' || activeSession.status === 'failed' ? 'Dismiss' : 'Close'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-foreground/45">
                  Select a terminal to inspect it.
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
