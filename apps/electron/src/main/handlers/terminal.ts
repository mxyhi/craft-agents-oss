import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS, type CreateTerminalParams, type TerminalSnapshot } from '../../shared/types'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.terminal.CREATE,
  RPC_CHANNELS.terminal.WRITE,
  RPC_CHANNELS.terminal.RESIZE,
  RPC_CHANNELS.terminal.CLOSE,
  RPC_CHANNELS.terminal.KILL,
  RPC_CHANNELS.terminal.LIST,
  RPC_CHANNELS.terminal.RESTORE,
  RPC_CHANNELS.terminal.CLEAR_SCROLLBACK,
] as const

export function registerTerminalHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { terminalManager } = deps

  terminalManager.onEvent((event) => {
    if (event.type === 'data') {
      pushTyped(server, RPC_CHANNELS.terminal.DATA, { to: 'workspace', workspaceId: event.workspaceId }, {
        sessionId: event.sessionId,
        data: event.data,
      })
      return
    }

    if (event.type === 'exit') {
      pushTyped(server, RPC_CHANNELS.terminal.EXIT, { to: 'workspace', workspaceId: event.workspaceId }, {
        sessionId: event.sessionId,
        exitCode: event.exitCode,
        exitSignal: event.exitSignal,
      })
      return
    }

    if (event.type === 'title') {
      pushTyped(server, RPC_CHANNELS.terminal.TITLE, { to: 'workspace', workspaceId: event.workspaceId }, {
        sessionId: event.sessionId,
        title: event.title,
      })
      return
    }

    if (event.type === 'cwd') {
      pushTyped(server, RPC_CHANNELS.terminal.CWD_CHANGED, { to: 'workspace', workspaceId: event.workspaceId }, {
        sessionId: event.sessionId,
        cwd: event.cwd,
      })
      return
    }

    pushTyped(server, RPC_CHANNELS.terminal.STATE_CHANGED, { to: 'workspace', workspaceId: event.workspaceId }, {
      sessionId: event.sessionId,
      state: event.state,
    })
  })

  server.handle(RPC_CHANNELS.terminal.CREATE, async (_ctx, params: CreateTerminalParams) => {
    return terminalManager.create(params)
  })

  server.handle(RPC_CHANNELS.terminal.WRITE, async (_ctx, sessionId: string, data: string) => {
    return terminalManager.write(sessionId, data)
  })

  server.handle(RPC_CHANNELS.terminal.RESIZE, async (_ctx, sessionId: string, cols: number, rows: number) => {
    return terminalManager.resize(sessionId, cols, rows)
  })

  server.handle(RPC_CHANNELS.terminal.CLOSE, async (_ctx, sessionId: string) => {
    return terminalManager.close(sessionId)
  })

  server.handle(RPC_CHANNELS.terminal.KILL, async (_ctx, sessionId: string) => {
    return terminalManager.kill(sessionId)
  })

  server.handle(RPC_CHANNELS.terminal.LIST, async (_ctx, workspaceId: string) => {
    return terminalManager.list(workspaceId)
  })

  server.handle(RPC_CHANNELS.terminal.RESTORE, async (_ctx, workspaceId: string, snapshot: TerminalSnapshot) => {
    return terminalManager.restore(workspaceId, snapshot)
  })

  server.handle(RPC_CHANNELS.terminal.CLEAR_SCROLLBACK, async (_ctx, sessionId: string) => {
    return terminalManager.clearScrollback(sessionId)
  })
}
