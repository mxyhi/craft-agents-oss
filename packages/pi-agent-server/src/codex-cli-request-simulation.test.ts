import { describe, expect, it } from 'bun:test'
import {
  applyCodexCliRequestHeaders,
  configureCodexCliRequestSimulation,
  restoreCodexCliRequestSimulation,
  resolveCodexResponsesUrl,
  rewriteCodexCliFetchInit,
  shouldApplyCodexCliRequestHeaders,
} from './codex-cli-request-simulation.ts'

describe('Codex CLI request simulation', () => {
  it('resolves Codex Responses URL like the Pi Codex provider', () => {
    expect(resolveCodexResponsesUrl('https://chatgpt.com/backend-api')).toBe(
      'https://chatgpt.com/backend-api/codex/responses',
    )
    expect(resolveCodexResponsesUrl('https://proxy.example/backend-api/codex')).toBe(
      'https://proxy.example/backend-api/codex/responses',
    )
    expect(resolveCodexResponsesUrl('https://proxy.example/backend-api/codex/responses')).toBe(
      'https://proxy.example/backend-api/codex/responses',
    )
  })

  it('matches only the configured Codex Responses endpoint URL', () => {
    expect(shouldApplyCodexCliRequestHeaders(
      'https://proxy.example/backend-api/codex/responses',
      'https://proxy.example/backend-api',
    )).toBe(true)
    expect(shouldApplyCodexCliRequestHeaders(
      'https://proxy.example/v1/chat/completions',
      'https://proxy.example/backend-api',
    )).toBe(false)
  })

  it('overwrites Pi SDK identity headers while preserving request routing headers', () => {
    const headers = applyCodexCliRequestHeaders({
      Authorization: 'Bearer sk-test',
      'content-type': 'application/json',
      originator: 'pi',
      'User-Agent': 'pi (darwin)',
      session_id: 'session-1',
      'x-client-request-id': 'session-1',
    })

    expect(headers.get('Authorization')).toBe('Bearer sk-test')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('originator')).toBe('codex_cli_rs')
    expect(headers.get('User-Agent')).toBe('codex_cli_rs/0.125.0')
    expect(headers.get('OpenAI-Beta')).toBe('responses=experimental')
    expect(headers.get('accept')).toBe('text/event-stream')
    expect(headers.get('session_id')).toBe('session-1')
    expect(headers.get('x-client-request-id')).toBe('session-1')
  })

  it('rewrites fetch init headers for the configured Codex endpoint', () => {
    const init = rewriteCodexCliFetchInit(
      'https://proxy.example/backend-api/codex/responses',
      {
        method: 'POST',
        headers: {
          originator: 'pi',
          'User-Agent': 'pi (darwin)',
        },
      },
      'https://proxy.example/backend-api',
    )

    const headers = new Headers(init?.headers)
    expect(headers.get('originator')).toBe('codex_cli_rs')
    expect(headers.get('User-Agent')).toBe('codex_cli_rs/0.125.0')
  })

  it('wraps global fetch only for the active Codex Responses endpoint', async () => {
    const originalFetch = globalThis.fetch
    let codexHeaders: Headers | undefined
    let otherHeaders: Headers | undefined
    const stubFetch = Object.assign(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
        const inputUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (inputUrl.endsWith('/codex/responses')) {
          codexHeaders = new Headers(init?.headers)
        } else {
          otherHeaders = new Headers(init?.headers)
        }
        return new Response('ok')
      },
      { preconnect: originalFetch.preconnect.bind(originalFetch) },
    )

    try {
      globalThis.fetch = stubFetch
      configureCodexCliRequestSimulation('https://proxy.example/backend-api')

      await fetch('https://proxy.example/backend-api/codex/responses', {
        headers: { originator: 'pi', 'User-Agent': 'pi (darwin)' },
      })
      await fetch('https://proxy.example/v1/chat/completions', {
        headers: { originator: 'pi' },
      })

      expect(codexHeaders?.get('originator')).toBe('codex_cli_rs')
      expect(codexHeaders?.get('User-Agent')).toBe('codex_cli_rs/0.125.0')
      expect(otherHeaders?.get('originator')).toBe('pi')
    } finally {
      restoreCodexCliRequestSimulation()
      globalThis.fetch = originalFetch
    }
  })
})
