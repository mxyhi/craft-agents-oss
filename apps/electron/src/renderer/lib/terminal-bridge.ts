import type { TerminalSplitDirection } from '../../shared/types'

export const TERMINAL_REQUEST_EVENT = 'craft:terminal-request'

export interface TerminalRequestPayload {
  action: 'open' | 'view-output' | 'rerun'
  cwd?: string
  title?: string
  sessionId?: string
  splitTabId?: string
  direction?: TerminalSplitDirection
  command?: string
  output?: string
}

export function dispatchTerminalRequest(payload: TerminalRequestPayload): void {
  window.dispatchEvent(new CustomEvent<TerminalRequestPayload>(TERMINAL_REQUEST_EVENT, {
    detail: payload,
  }))
}

function buildUniqueDelimiter(output: string): string {
  const base = '__CRAFT_TERMINAL_OUTPUT__'
  let delimiter = base
  let suffix = 1

  while (output.includes(delimiter)) {
    delimiter = `${base}_${suffix++}`
  }

  return delimiter
}

export function buildTerminalOutputReplayCommand(shell: string, output: string): string {
  const delimiter = buildUniqueDelimiter(output)

  if (/pwsh|powershell/i.test(shell)) {
    return `@'\n${output}\n'@\n`
  }

  return `cat <<'${delimiter}'\n${output}\n${delimiter}\n`
}

export function normalizeTerminalCommand(command: string): string {
  return command.endsWith('\n') || command.endsWith('\r')
    ? command
    : `${command}\n`
}
