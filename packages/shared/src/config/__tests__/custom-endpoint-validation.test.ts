import { describe, expect, it } from 'bun:test'
import { StoredConfigSchema } from '../validators.ts'

describe('custom endpoint config validation', () => {
  it('accepts Codex Responses custom endpoints', () => {
    const result = StoredConfigSchema.safeParse({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      llmConnections: [{
        slug: 'codex-proxy',
        name: 'Codex Proxy',
        providerType: 'pi_compat',
        authType: 'api_key_with_endpoint',
        baseUrl: 'https://proxy.example/backend-api',
        customEndpoint: { api: 'openai-codex-responses' },
        createdAt: 1,
      }],
    })

    expect(result.success).toBe(true)
  })
})
