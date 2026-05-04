import { describe, expect, it } from 'bun:test'
import {
  buildCodexCliRequestHeaders,
  resolveCustomEndpointRequestHeaders,
  resolveCustomEndpointRuntimeBaseUrl,
  withCodexResponsesCompat,
} from './custom-endpoint-codex-headers.ts'

describe('custom endpoint Codex CLI header simulation', () => {
  it('builds sub2api-detectable Codex CLI headers', () => {
    const headers = buildCodexCliRequestHeaders()

    expect(headers.originator).toBe('codex_cli_rs')
    expect(headers['User-Agent'].startsWith('codex_cli_rs/')).toBe(true)
  })

  it('enables headers only for OpenAI Responses custom endpoints with the switch on', () => {
    expect(resolveCustomEndpointRequestHeaders({
      api: 'openai-responses',
      simulateCodexCliHeaders: true,
    })).toEqual(buildCodexCliRequestHeaders())

    expect(resolveCustomEndpointRequestHeaders({
      api: 'openai-responses',
      simulateCodexCliHeaders: false,
    })).toBeUndefined()

    expect(resolveCustomEndpointRequestHeaders({
      api: 'openai-completions',
      simulateCodexCliHeaders: true,
    })).toBeUndefined()
  })

  it('adds Responses session header compatibility while preserving existing compat', () => {
    const model = withCodexResponsesCompat({
      id: 'gpt-5-codex',
      compat: { customFlag: 'keep' },
    }, {
      api: 'openai-responses',
      simulateCodexCliHeaders: true,
    })

    expect(model.compat).toEqual({
      customFlag: 'keep',
      sendSessionIdHeader: true,
    })
  })

  it('normalizes OpenAI Responses base URLs to produce /v1/responses requests', () => {
    const customEndpoint = {
      api: 'openai-responses' as const,
      simulateCodexCliHeaders: false,
    }

    expect(resolveCustomEndpointRuntimeBaseUrl('http://127.0.0.1:9208', customEndpoint))
      .toBe('http://127.0.0.1:9208/v1')
    expect(resolveCustomEndpointRuntimeBaseUrl('http://127.0.0.1:9208/v1', customEndpoint))
      .toBe('http://127.0.0.1:9208/v1')
    expect(resolveCustomEndpointRuntimeBaseUrl('http://127.0.0.1:9208/v1/responses', customEndpoint))
      .toBe('http://127.0.0.1:9208/v1')
    expect(resolveCustomEndpointRuntimeBaseUrl('http://127.0.0.1:9208/codex/responses', customEndpoint))
      .toBe('http://127.0.0.1:9208/v1')
  })

  it('leaves non-Responses custom endpoint base URLs unchanged', () => {
    expect(resolveCustomEndpointRuntimeBaseUrl('http://127.0.0.1:9208', {
      api: 'openai-completions',
      simulateCodexCliHeaders: true,
    })).toBe('http://127.0.0.1:9208')
  })
})
