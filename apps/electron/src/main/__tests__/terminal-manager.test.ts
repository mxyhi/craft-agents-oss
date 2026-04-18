import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IPty, IDisposable } from 'node-pty'
import type { TerminalManagerEvent } from '../terminal-manager'
import { TerminalManager } from '../terminal-manager'

class FakePty implements IPty {
  readonly pid: number
  cols: number
  rows: number
  process = 'fake-shell'
  handleFlowControl = true
  writes: Array<string | Buffer> = []
  resizeCalls: Array<{ cols: number; rows: number }> = []
  killCalls: string[] = []
  clearCalls = 0

  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()

  constructor(pid: number, cols: number, rows: number) {
    this.pid = pid
    this.cols = cols
    this.rows = rows
  }

  readonly onData = (listener: (data: string) => void): IDisposable => {
    this.dataListeners.add(listener)
    return {
      dispose: () => {
        this.dataListeners.delete(listener)
      },
    }
  }

  readonly onExit = (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
    this.exitListeners.add(listener)
    return {
      dispose: () => {
        this.exitListeners.delete(listener)
      },
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.resizeCalls.push({ cols, rows })
  }

  clear(): void {
    this.clearCalls += 1
  }

  write(data: string | Buffer): void {
    this.writes.push(data)
  }

  kill(signal?: string): void {
    this.killCalls.push(signal ?? 'SIGHUP')
  }

  pause(): void {}

  resume(): void {}

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data)
    }
  }

  emitExit(exitCode: number, signal?: number): void {
    for (const listener of this.exitListeners) {
      listener({ exitCode, signal })
    }
  }
}

function createManagerHarness() {
  const ptys: FakePty[] = []
  const manager = new TerminalManager((file, _args, options) => {
    const pty = new FakePty(10_000 + ptys.length, options.cols ?? 120, options.rows ?? 36)
    pty.process = file
    ptys.push(pty)
    return pty
  })

  return {
    manager,
    ptys,
    latestPty(): FakePty {
      const pty = ptys.at(-1)
      if (!pty) throw new Error('Expected PTY instance')
      return pty
    },
  }
}

function findEvent<TType extends TerminalManagerEvent['type']>(
  manager: TerminalManager,
  type: TType,
  predicate: (event: Extract<TerminalManagerEvent, { type: TType }>) => boolean,
): Extract<TerminalManagerEvent, { type: TType }> | undefined {
  return manager.getEventHistory().find((event) => {
    if (event.type !== type) return false
    return predicate(event as Extract<TerminalManagerEvent, { type: TType }>)
  }) as Extract<TerminalManagerEvent, { type: TType }> | undefined
}

describe('TerminalManager', () => {
  let workspaceDir: string

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'craft-terminal-manager-'))
  })

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true })
  })

  it('creates terminal sessions, forwards output, and records state changes', async () => {
    const { manager, latestPty } = createManagerHarness()
    const session = await manager.create({
      workspaceId: 'ws-1',
      cwd: workspaceDir,
      shell: '/bin/zsh',
      title: 'Workspace shell',
      cols: 90,
      rows: 28,
    })

    expect(session.workspaceId).toBe('ws-1')
    expect(session.status).toBe('running')
    expect(session.pid).toBe(10_000)

    await manager.write(session.id, 'printf "READY\\n"\r')
    const pty = latestPty()
    expect(pty.writes.at(-1)).toBe('printf "READY\\n"\r')

    pty.emitData('READY\r\n')

    const dataEvent = findEvent(manager, 'data', (event) => {
      return event.sessionId === session.id && event.data.includes('READY')
    })
    expect(dataEvent?.data).toContain('READY')

    const stateEvent = findEvent(manager, 'state-changed', (event) => {
      return event.sessionId === session.id && event.state.lastOutputSummary?.includes('READY') === true
    })
    expect(stateEvent?.state.lastOutputSummary).toContain('READY')
  })

  it('resizes PTY sessions and persists latest dimensions', async () => {
    const { manager, latestPty } = createManagerHarness()
    const session = await manager.create({
      workspaceId: 'ws-1',
      cwd: workspaceDir,
      shell: '/bin/bash',
      cols: 80,
      rows: 24,
    })

    await manager.resize(session.id, 132, 40)

    const pty = latestPty()
    expect(pty.resizeCalls).toEqual([{ cols: 132, rows: 40 }])

    const [updated] = await manager.list('ws-1')
    expect(updated.cols).toBe(132)
    expect(updated.rows).toBe(40)
  })

  it('captures exit metadata when child process exits', async () => {
    const { manager, latestPty } = createManagerHarness()
    const session = await manager.create({
      workspaceId: 'ws-1',
      cwd: workspaceDir,
      shell: '/bin/bash',
    })

    latestPty().emitExit(7, 0)

    const exitEvent = findEvent(manager, 'exit', (event) => event.sessionId === session.id)
    expect(exitEvent?.exitCode).toBe(7)

    const [updated] = await manager.list('ws-1')
    expect(updated.status).toBe('exited')
    expect(updated.exitCode).toBe(7)
  })

  it('parses title and cwd updates from terminal OSC sequences', async () => {
    const { manager, latestPty } = createManagerHarness()
    const session = await manager.create({
      workspaceId: 'ws-1',
      cwd: workspaceDir,
      shell: '/bin/bash',
      title: 'Initial',
    })

    latestPty().emitData('\u001b]0;Renamed terminal\u0007')
    latestPty().emitData('\u001b]7;file://localhost/tmp/next-workspace\u0007')

    const titleEvent = findEvent(manager, 'title', (event) => event.sessionId === session.id)
    const cwdEvent = findEvent(manager, 'cwd', (event) => event.sessionId === session.id)

    expect(titleEvent?.title).toBe('Renamed terminal')
    expect(cwdEvent?.cwd).toBe('/tmp/next-workspace')
  })

  it('restores launch configs as running PTY sessions', async () => {
    const { manager } = createManagerHarness()

    const restored = await manager.restore('ws-1', {
      dockVisible: true,
      dockHeight: 320,
      inspectorVisible: true,
      tabs: [],
      panes: [],
      sessionLaunchConfigs: [
        {
          sessionId: 'old-1',
          config: {
            workspaceId: 'ws-1',
            cwd: workspaceDir,
            shell: '/bin/zsh',
            title: 'Restored terminal',
            cols: 100,
            rows: 30,
          },
        },
      ],
    })

    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('old-1')
    expect(restored[0].restored).toBe(true)
    expect(restored[0].status).toBe('running')
    expect(restored[0].cols).toBe(100)
    expect(restored[0].rows).toBe(30)
  })

  it('fails fast on invalid working directories', async () => {
    const { manager } = createManagerHarness()

    await expect(manager.create({
      workspaceId: 'ws-1',
      cwd: join(workspaceDir, 'missing'),
      shell: '/bin/zsh',
    })).rejects.toThrow('Terminal working directory does not exist')
  })
})
