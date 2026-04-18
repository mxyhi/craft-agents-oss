import * as React from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import type { TerminalSession } from '../../../shared/types'

interface TerminalPaneViewProps {
  session: TerminalSession
  output: string
  active: boolean
  onActivate: () => void
}

function createTerminalTheme(isDark: boolean): NonNullable<ConstructorParameters<typeof XTerm>[0]>['theme'] {
  if (isDark) {
    return {
      background: '#0c1017',
      foreground: '#e7edf8',
      cursor: '#f7fafc',
      cursorAccent: '#0c1017',
      black: '#101826',
      red: '#ff7b72',
      green: '#7ee787',
      yellow: '#d29922',
      blue: '#79c0ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#d2dae5',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#a5d6ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    }
  }

  return {
    background: '#fffdf8',
    foreground: '#172033',
    cursor: '#172033',
    cursorAccent: '#fffdf8',
    black: '#1b2432',
    red: '#c2410c',
    green: '#15803d',
    yellow: '#a16207',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0f766e',
    white: '#f8fafc',
    brightBlack: '#475569',
    brightRed: '#ea580c',
    brightGreen: '#16a34a',
    brightYellow: '#ca8a04',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#14b8a6',
    brightWhite: '#ffffff',
  }
}

export function TerminalPaneView({
  session,
  output,
  active,
  onActivate,
}: TerminalPaneViewProps) {
  const { isDark } = useTheme()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const terminalRef = React.useRef<XTerm | null>(null)
  const fitAddonRef = React.useRef<FitAddon | null>(null)
  const lastOutputRef = React.useRef('')
  const statusRef = React.useRef(session.status)

  statusRef.current = session.status

  React.useEffect(() => {
    if (!containerRef.current) return

    const terminal = new XTerm({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 10_000,
      theme: createTerminalTheme(isDark),
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      event.preventDefault()
      void window.electronAPI.openUrl(uri)
    })

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.open(containerRef.current)

    terminal.onData((data) => {
      if (statusRef.current === 'exited' || statusRef.current === 'killed' || statusRef.current === 'failed') {
        return
      }
      void window.electronAPI.writeTerminal(session.id, data).catch((error) => {
        console.error('Failed to write terminal data:', error)
      })
    })

    const resizeTerminal = () => {
      fitAddon.fit()
      const cols = terminal.cols
      const rows = terminal.rows
      if (cols > 0 && rows > 0) {
        void window.electronAPI.resizeTerminal(session.id, cols, rows).catch((error) => {
          console.error('Failed to resize terminal:', error)
        })
      }
    }

    const observer = new ResizeObserver(() => {
      resizeTerminal()
    })
    observer.observe(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    resizeTerminal()

    return () => {
      observer.disconnect()
      fitAddonRef.current = null
      terminalRef.current = null
      terminal.dispose()
    }
  }, [isDark, session.id])

  React.useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    if (output.startsWith(lastOutputRef.current)) {
      const delta = output.slice(lastOutputRef.current.length)
      if (delta) terminal.write(delta)
    } else {
      terminal.reset()
      if (output) terminal.write(output)
    }

    lastOutputRef.current = output
  }, [output])

  React.useEffect(() => {
    const terminal = terminalRef.current
    if (terminal) {
      terminal.options.theme = createTerminalTheme(isDark)
    }
  }, [isDark])

  React.useEffect(() => {
    if (!active) return
    terminalRef.current?.focus()
    fitAddonRef.current?.fit()
  }, [active])

  return (
    <div
      className={cn(
        'relative h-full min-h-0 overflow-hidden rounded-[12px] border bg-background/90',
        active ? 'border-foreground/20 shadow-minimal' : 'border-border/70',
      )}
      onMouseDown={onActivate}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-foreground/55">
        <span className="truncate">{session.title}</span>
        <span className="truncate font-mono normal-case tracking-normal text-foreground/45">
          {session.cwd}
        </span>
      </div>

      <div ref={containerRef} className="h-[calc(100%-33px)] w-full px-1 py-1" />

      {(session.status === 'exited' || session.status === 'killed' || session.status === 'failed') && (
        <div className="pointer-events-none absolute right-3 top-10 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] text-foreground/60 shadow-minimal">
          {session.status}
          {typeof session.exitCode === 'number' ? ` · ${session.exitCode}` : ''}
        </div>
      )}
    </div>
  )
}
