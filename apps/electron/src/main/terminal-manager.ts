import { spawn as spawnPtyNative, type IPty } from 'node-pty'
import { chmodSync, existsSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type {
  CreateTerminalParams,
  TerminalCwdChangedEvent,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSession,
  TerminalSnapshot,
  TerminalStateChangedEvent,
  TerminalTitleEvent,
} from '../shared/types'

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 36
const MAX_OUTPUT_SUMMARY_CHARS = 4_000
const CLOSE_FALLBACK_MS = 500

const TITLE_SEQUENCE = /\u001b\](?:0|2);([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g
const CWD_SEQUENCE = /\u001b\]7;file:\/\/[^/]*([^\\\u0007\u001b]*)(?:\u0007|\u001b\\)/g

let spawnHelperPrepared = false

export type TerminalManagerEvent =
  | ({ type: 'data'; workspaceId: string } & TerminalDataEvent)
  | ({ type: 'exit'; workspaceId: string } & TerminalExitEvent)
  | ({ type: 'title'; workspaceId: string } & TerminalTitleEvent)
  | ({ type: 'cwd'; workspaceId: string } & TerminalCwdChangedEvent)
  | ({ type: 'state-changed'; workspaceId: string } & TerminalStateChangedEvent)

interface ManagedTerminalSession {
  readonly launchConfig: CreateTerminalParams
  readonly shellArgs: string[]
  pty: IPty
  session: TerminalSession
  closeTimeout: ReturnType<typeof setTimeout> | null
  pendingKill: boolean
  pendingClose: boolean
  disposeDataListener: (() => void) | null
  disposeExitListener: (() => void) | null
}

type TerminalEventListener = (event: TerminalManagerEvent) => void
type SpawnPtyFn = (
  file: string,
  args: string[],
  options: Parameters<typeof spawnPtyNative>[2],
) => IPty

function resolveShell(requestedShell?: string): string {
  return requestedShell || process.env.SHELL || process.env.COMSPEC || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
}

function resolveTitle(requestedTitle: string | undefined, cwd: string): string {
  if (requestedTitle && requestedTitle.trim().length > 0) return requestedTitle.trim()
  return basename(cwd) || cwd
}

function createSessionId(preferredId?: string): string {
  if (preferredId && preferredId.trim().length > 0) return preferredId
  return `terminal_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function cloneSession(session: TerminalSession): TerminalSession {
  return { ...session }
}

function updateOutputSummary(previous: string | undefined, chunk: string): string {
  const next = `${previous ?? ''}${chunk}`
  if (next.length <= MAX_OUTPUT_SUMMARY_CHARS) return next
  return next.slice(-MAX_OUTPUT_SUMMARY_CHARS)
}

function createTerminalEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: process.env.TERM || 'xterm-256color',
    COLORTERM: process.env.COLORTERM || 'truecolor',
    TERM_PROGRAM: 'Craft Agents',
    CRAFT_TERMINAL: '1',
    PWD: cwd,
  }
}

function resolveShellArgs(_shell: string): string[] {
  return []
}

function normalizeDecodedPath(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath)
  } catch {
    return rawPath
  }
}

function ensureSpawnHelperExecutable(): void {
  if (spawnHelperPrepared || process.platform === 'win32') return
  const packageDir = dirname(require.resolve('node-pty/package.json'))
  const helperPath = `${packageDir}/prebuilds/${process.platform}-${process.arch}/spawn-helper`

  if (existsSync(helperPath)) {
    chmodSync(helperPath, 0o755)
  }

  spawnHelperPrepared = true
}

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedTerminalSession>()
  private readonly listeners = new Set<TerminalEventListener>()
  private readonly eventHistory: TerminalManagerEvent[] = []

  constructor(private readonly spawnPty: SpawnPtyFn = spawnPtyNative) {}

  onEvent(listener: TerminalEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getEventHistory(): readonly TerminalManagerEvent[] {
    return [...this.eventHistory]
  }

  async dispose(): Promise<void> {
    const sessionIds = [...this.sessions.keys()]
    for (const sessionId of sessionIds) {
      await this.forceDisposeSession(sessionId)
    }
    this.listeners.clear()
  }

  async create(params: CreateTerminalParams): Promise<TerminalSession> {
    const entry = this.spawnSession(params, { restored: false, initialStatus: 'starting' })
    return cloneSession(entry.session)
  }

  async write(sessionId: string, data: string): Promise<void> {
    const entry = this.ensureSession(sessionId)
    this.ensureWritable(entry)
    entry.pty.write(data)
    this.touch(entry)
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const entry = this.ensureSession(sessionId)
    this.ensureWritable(entry)
    entry.pty.resize(cols, rows)
    entry.session.cols = cols
    entry.session.rows = rows
    this.touch(entry)
    this.emitStateChanged(entry)
  }

  async close(sessionId: string): Promise<void> {
    const entry = this.ensureSession(sessionId)
    if (this.isFinal(entry.session.status)) return

    entry.pendingClose = true
    if (entry.closeTimeout) clearTimeout(entry.closeTimeout)
    entry.pty.write('exit\r')
    this.touch(entry)
    entry.closeTimeout = setTimeout(() => {
      if (!this.sessions.has(sessionId) || this.isFinal(entry.session.status)) return
      entry.pendingKill = true
      entry.pty.kill()
    }, CLOSE_FALLBACK_MS)
  }

  async kill(sessionId: string): Promise<void> {
    const entry = this.ensureSession(sessionId)
    if (this.isFinal(entry.session.status)) return
    entry.pendingKill = true
    if (entry.closeTimeout) {
      clearTimeout(entry.closeTimeout)
      entry.closeTimeout = null
    }
    entry.pty.kill()
  }

  async list(workspaceId: string): Promise<TerminalSession[]> {
    return [...this.sessions.values()]
      .filter((entry) => entry.session.workspaceId === workspaceId)
      .map((entry) => cloneSession(entry.session))
  }

  async restore(workspaceId: string, snapshot: TerminalSnapshot): Promise<TerminalSession[]> {
    const restoredSessions: TerminalSession[] = []

    for (const entry of snapshot.sessionLaunchConfigs) {
      if (entry.config.workspaceId !== workspaceId) continue
      const managed = this.spawnSession(entry.config, {
        restored: true,
        initialStatus: 'restoring',
        preferredId: entry.sessionId,
      })
      restoredSessions.push(cloneSession(managed.session))
    }

    return restoredSessions
  }

  async clearScrollback(sessionId: string): Promise<void> {
    const entry = this.ensureSession(sessionId)
    entry.session.lastOutputSummary = ''
    entry.pty.clear()
    this.touch(entry)
    this.emitStateChanged(entry)
  }

  private spawnSession(
    params: CreateTerminalParams,
    options: { restored: boolean; initialStatus: TerminalSession['status']; preferredId?: string },
  ): ManagedTerminalSession {
    ensureSpawnHelperExecutable()
    if (!existsSync(params.cwd) || !statSync(params.cwd).isDirectory()) {
      throw new Error(`Terminal working directory does not exist: ${params.cwd}`)
    }
    const now = Date.now()
    const shell = resolveShell(params.shell)
    const shellArgs = resolveShellArgs(shell)
    const session: TerminalSession = {
      id: createSessionId(options.preferredId),
      workspaceId: params.workspaceId,
      cwd: params.cwd,
      shell,
      title: resolveTitle(params.title, params.cwd),
      status: options.initialStatus,
      cols: params.cols ?? DEFAULT_COLS,
      rows: params.rows ?? DEFAULT_ROWS,
      restored: options.restored,
      createdAt: now,
      lastActiveAt: now,
      lastOutputSummary: '',
    }

    const pty = this.spawnPty(shell, shellArgs, {
      name: 'xterm-256color',
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      env: createTerminalEnv(session.cwd),
      handleFlowControl: true,
      ...(process.platform === 'win32' ? { useConpty: true } : {}),
    })

    session.pid = pty.pid
    session.status = 'running'

    const entry: ManagedTerminalSession = {
      launchConfig: {
        workspaceId: params.workspaceId,
        cwd: params.cwd,
        shell: params.shell,
        title: params.title,
        cols: params.cols,
        rows: params.rows,
      },
      shellArgs,
      pty,
      session,
      closeTimeout: null,
      pendingKill: false,
      pendingClose: false,
      disposeDataListener: null,
      disposeExitListener: null,
    }

    this.sessions.set(session.id, entry)
    this.attachListeners(entry)
    this.emitStateChanged(entry)
    return entry
  }

  private attachListeners(entry: ManagedTerminalSession): void {
    const disposeData = entry.pty.onData((data) => {
      entry.session.lastOutputSummary = updateOutputSummary(entry.session.lastOutputSummary, data)
      this.touch(entry)
      this.emit({
        type: 'data',
        workspaceId: entry.session.workspaceId,
        sessionId: entry.session.id,
        data,
      })

      this.syncTitleFromOutput(entry, data)
      this.syncCwdFromOutput(entry, data)
      this.emitStateChanged(entry)
    })

    const disposeExit = entry.pty.onExit(({ exitCode, signal }) => {
      if (entry.closeTimeout) {
        clearTimeout(entry.closeTimeout)
        entry.closeTimeout = null
      }

      entry.session.exitCode = exitCode
      entry.session.exitSignal = signal
      entry.session.lastActiveAt = Date.now()
      entry.session.status = entry.pendingKill ? 'killed' : 'exited'

      this.emit({
        type: 'exit',
        workspaceId: entry.session.workspaceId,
        sessionId: entry.session.id,
        exitCode,
        exitSignal: signal,
      })
      this.emitStateChanged(entry)
      this.disposeListeners(entry)
    })

    entry.disposeDataListener = () => disposeData.dispose()
    entry.disposeExitListener = () => disposeExit.dispose()
  }

  private syncTitleFromOutput(entry: ManagedTerminalSession, data: string): void {
    TITLE_SEQUENCE.lastIndex = 0
    let match = TITLE_SEQUENCE.exec(data)
    let nextTitle: string | null = null
    while (match) {
      const title = match[1]?.trim()
      if (title) nextTitle = title
      match = TITLE_SEQUENCE.exec(data)
    }

    if (!nextTitle || nextTitle === entry.session.title) return
    entry.session.title = nextTitle
    this.emit({
      type: 'title',
      workspaceId: entry.session.workspaceId,
      sessionId: entry.session.id,
      title: nextTitle,
    })
  }

  private syncCwdFromOutput(entry: ManagedTerminalSession, data: string): void {
    CWD_SEQUENCE.lastIndex = 0
    let match = CWD_SEQUENCE.exec(data)
    let nextCwd: string | null = null
    while (match) {
      const rawPath = match[1]
      if (rawPath) nextCwd = normalizeDecodedPath(rawPath)
      match = CWD_SEQUENCE.exec(data)
    }

    if (!nextCwd || nextCwd === entry.session.cwd) return
    entry.session.cwd = nextCwd
    this.emit({
      type: 'cwd',
      workspaceId: entry.session.workspaceId,
      sessionId: entry.session.id,
      cwd: nextCwd,
    })
  }

  private ensureSession(sessionId: string): ManagedTerminalSession {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      throw new Error(`Terminal session not found: ${sessionId}`)
    }
    return entry
  }

  private ensureWritable(entry: ManagedTerminalSession): void {
    if (this.isFinal(entry.session.status)) {
      throw new Error(`Terminal session is no longer writable: ${entry.session.id}`)
    }
  }

  private touch(entry: ManagedTerminalSession): void {
    entry.session.lastActiveAt = Date.now()
    if (entry.session.status === 'starting' || entry.session.status === 'restoring') {
      entry.session.status = 'running'
    }
  }

  private emitStateChanged(entry: ManagedTerminalSession): void {
    this.emit({
      type: 'state-changed',
      workspaceId: entry.session.workspaceId,
      sessionId: entry.session.id,
      state: cloneSession(entry.session),
    })
  }

  private emit(event: TerminalManagerEvent): void {
    this.eventHistory.push(event)
    if (this.eventHistory.length > 200) this.eventHistory.shift()
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private async forceDisposeSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    this.disposeListeners(entry)
    if (!this.isFinal(entry.session.status)) {
      entry.pendingKill = true
      try {
        entry.pty.kill()
      } catch (error) {
        console.warn('[terminal] failed to kill during dispose', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (entry.closeTimeout) clearTimeout(entry.closeTimeout)
    this.sessions.delete(sessionId)
  }

  private disposeListeners(entry: ManagedTerminalSession): void {
    entry.disposeDataListener?.()
    entry.disposeDataListener = null
    entry.disposeExitListener?.()
    entry.disposeExitListener = null
  }

  private isFinal(status: TerminalSession['status']): boolean {
    return status === 'exited' || status === 'killed' || status === 'failed'
  }
}
