import type { CustomEndpointApi, CustomEndpointConfig } from '@config/llm-connections'

export type PresetKey = string

interface CustomEndpointProtocolOption {
  value: CustomEndpointApi
  label: string
}

export const CUSTOM_ENDPOINT_PROTOCOL_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Compatible' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Compatible' },
] as const satisfies readonly CustomEndpointProtocolOption[]

export function shouldShowCodexCliHeadersSwitch(api: CustomEndpointApi) {
  return api === 'openai-responses'
}

export function buildCustomEndpointConfigForSubmit(
  api: CustomEndpointApi,
  simulateCodexCliHeaders: boolean,
): CustomEndpointConfig {
  return {
    api,
    ...(shouldShowCodexCliHeadersSwitch(api) && simulateCodexCliHeaders
      ? { simulateCodexCliHeaders: true }
      : {}),
  }
}

/**
 * Preset keys that are regional variants of a canonical Pi auth provider.
 * The Pi SDK recognizes both 'minimax' and 'minimax-cn' as separate providers
 * with distinct base URLs (api.minimax.io vs api.minimaxi.com), so only
 * 'minimax-global' needs aliasing — 'minimax-cn' maps 1:1 to the Pi SDK provider.
 */
const PI_AUTH_PROVIDER_ALIASES: Record<string, string> = {
  'minimax-global': 'minimax',
}

export function resolvePiAuthProviderForSubmit(
  activePreset: PresetKey,
  lastNonCustomPreset: PresetKey | null
): string | undefined {
  if (activePreset === 'custom') {
    // Pi SDK needs a provider hint for auth header formatting even when
    // the URL is user-provided — default to anthropic as the safest baseline.
    const resolved = lastNonCustomPreset && lastNonCustomPreset !== 'custom'
      ? lastNonCustomPreset
      : 'anthropic'
    return PI_AUTH_PROVIDER_ALIASES[resolved] ?? resolved
  }

  return PI_AUTH_PROVIDER_ALIASES[activePreset] ?? activePreset
}

export function resolvePresetStateForBaseUrlChange(params: {
  matchedPreset: PresetKey
  activePreset: PresetKey
  activePresetHasEmptyUrl: boolean
  lastNonCustomPreset: PresetKey | null
}): { activePreset: PresetKey; lastNonCustomPreset: PresetKey | null } {
  const { matchedPreset, activePreset, activePresetHasEmptyUrl, lastNonCustomPreset } = params

  if (matchedPreset !== 'custom') {
    return {
      activePreset: matchedPreset,
      lastNonCustomPreset: matchedPreset,
    }
  }

  if (activePresetHasEmptyUrl) {
    return {
      activePreset,
      lastNonCustomPreset,
    }
  }

  return {
    activePreset: 'custom',
    lastNonCustomPreset,
  }
}
