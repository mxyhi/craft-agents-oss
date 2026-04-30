import { describe, expect, it } from 'bun:test'
import {
  applyCodexCliRequestHeaders,
  configureCodexCliRequestSimulation,
  restoreCodexCliRequestSimulation,
  resolveCustomEndpointRuntimeApi,
  rewriteCodexCliFetchInit,
  shouldApplyCodexCliRequestHeaders,
} from './codex-cli-request-simulation.ts'

type JsonObject = Record<string, unknown>

describe('Codex CLI request simulation', () => {
  it('uses OpenAI Responses runtime adapter for Codex CLI proxy simulation', () => {
    expect(resolveCustomEndpointRuntimeApi('openai-codex-responses')).toBe('openai-responses')
    expect(resolveCustomEndpointRuntimeApi('openai-completions')).toBe('openai-completions')
    expect(resolveCustomEndpointRuntimeApi('anthropic-messages')).toBe('anthropic-messages')
  })

  it('matches requests under the configured custom endpoint without simulating endpoint paths', () => {
    expect(shouldApplyCodexCliRequestHeaders(
      'https://proxy.example/v1/responses',
      'https://proxy.example',
    )).toBe(true)
    expect(shouldApplyCodexCliRequestHeaders(
      'https://proxy.example/v1/responses',
      'https://proxy.example/v1',
    )).toBe(true)
    expect(shouldApplyCodexCliRequestHeaders(
      'https://proxy.example/other/responses',
      'https://proxy.example/v1',
    )).toBe(false)
    expect(shouldApplyCodexCliRequestHeaders(
      'https://other.example/v1/responses',
      'https://proxy.example/v1',
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

  it('rewrites fetch init headers for requests under the configured custom endpoint', () => {
    const init = rewriteCodexCliFetchInit(
      'https://proxy.example/v1/responses',
      {
        method: 'POST',
        headers: {
          originator: 'pi',
          'User-Agent': 'pi (darwin)',
        },
      },
      'https://proxy.example/v1',
    )

    const headers = new Headers(init?.headers)
    expect(headers.get('originator')).toBe('codex_cli_rs')
    expect(headers.get('User-Agent')).toBe('codex_cli_rs/0.125.0')
  })

  it('removes persisted output item ids from store=false Responses history', () => {
    const init = rewriteCodexCliFetchInit(
      'https://proxy.example/v1/responses',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.5',
          stream: true,
          store: false,
          include: ['reasoning.encrypted_content'],
          input: [
            {
              type: 'reasoning',
              id: 'rs_0acfcd8044d8f12f0169f22a1782f0819ab0d65374092d7ee8',
              summary: [],
              encrypted_content: 'encrypted-reasoning',
            },
            {
              type: 'message',
              id: 'msg_123',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'done' }],
            },
            {
              type: 'function_call',
              id: 'fc_123',
              call_id: 'call_123',
              name: 'tool',
              arguments: '{}',
            },
            {
              type: 'function_call_output',
              call_id: 'call_123',
              output: 'ok',
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'next' }],
            },
          ],
        }),
      },
      'https://proxy.example/v1',
    )

    expect(typeof init?.body).toBe('string')
    if (typeof init?.body !== 'string') {
      throw new Error('expected rewritten request body to be a string')
    }
    const parsed: unknown = JSON.parse(init.body)
    if (!isJsonObject(parsed) || !Array.isArray(parsed.input) || !parsed.input.every(isJsonObject)) {
      throw new Error('expected rewritten request body to contain object input items')
    }
    const input = parsed.input
    expect(input[0]).toEqual({
      type: 'reasoning',
      summary: [],
      encrypted_content: 'encrypted-reasoning',
    })
    expect(input[1].id).toBeUndefined()
    expect(input[2].id).toBeUndefined()
    expect(input[3].call_id).toBe('call_123')
    expect(input[4].role).toBe('user')
  })

  it('wraps global fetch only for the active custom endpoint base URL', async () => {
    const originalFetch = globalThis.fetch
    let codexHeaders: Headers | undefined
    let otherHeaders: Headers | undefined
    const stubFetch = Object.assign(
      async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
        const inputUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (inputUrl.startsWith('https://proxy.example/v1/')) {
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
      configureCodexCliRequestSimulation('https://proxy.example/v1')

      await fetch('https://proxy.example/v1/responses', {
        headers: { originator: 'pi', 'User-Agent': 'pi (darwin)' },
      })
      await fetch('https://proxy.example/other/responses', {
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
