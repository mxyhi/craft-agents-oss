import { describe, expect, it } from 'bun:test'
import {
  buildTerminalOutputReplayCommand,
  normalizeTerminalCommand,
} from '../terminal-bridge'

describe('terminal bridge helpers', () => {
  it('builds heredoc replay commands for posix shells', () => {
    const command = buildTerminalOutputReplayCommand('/bin/zsh', 'hello\nworld')

    expect(command).toContain("cat <<'__CRAFT_TERMINAL_OUTPUT__'")
    expect(command).toContain('hello\nworld')
    expect(command.trimEnd().endsWith('__CRAFT_TERMINAL_OUTPUT__')).toBe(true)
  })

  it('uses a different delimiter when output already contains the default marker', () => {
    const command = buildTerminalOutputReplayCommand('/bin/bash', '__CRAFT_TERMINAL_OUTPUT__\nvalue')

    expect(command).toContain("__CRAFT_TERMINAL_OUTPUT___1")
  })

  it('builds here-string replay commands for powershell shells', () => {
    const command = buildTerminalOutputReplayCommand('powershell.exe', 'hello')

    expect(command).toBe("@'\nhello\n'@\n")
  })

  it('ensures replay commands end with a newline', () => {
    expect(normalizeTerminalCommand('ls -la')).toBe('ls -la\n')
    expect(normalizeTerminalCommand('ls -la\n')).toBe('ls -la\n')
  })
})
