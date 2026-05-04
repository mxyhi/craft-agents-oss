type CustomEndpointApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'

export interface CustomEndpointCodexHeaderConfig {
  api: CustomEndpointApi
  simulateCodexCliHeaders?: boolean
}

interface CodexResponsesCompat {
  sendSessionIdHeader?: boolean
  [key: string]: unknown
}

const CODEX_CLI_ORIGINATOR = 'codex_cli_rs'
const CODEX_CLI_USER_AGENT = `${CODEX_CLI_ORIGINATOR}/0.0.0 (unknown unknown; unknown) craft-agents`
const RESPONSES_SUFFIX = '/responses'

export function shouldSimulateCodexCliHeaders(customEndpoint?: CustomEndpointCodexHeaderConfig) {
  return customEndpoint?.api === 'openai-responses' && customEndpoint.simulateCodexCliHeaders === true
}

export function buildCodexCliRequestHeaders() {
  // sub2api gates official Codex requests by `originator` or Codex User-Agent prefix.
  return {
    originator: CODEX_CLI_ORIGINATOR,
    'User-Agent': CODEX_CLI_USER_AGENT,
  }
}

export function resolveCustomEndpointRequestHeaders(customEndpoint?: CustomEndpointCodexHeaderConfig) {
  if (!shouldSimulateCodexCliHeaders(customEndpoint)) {
    return undefined
  }

  return buildCodexCliRequestHeaders()
}

export function resolveCustomEndpointRuntimeBaseUrl(
  baseUrl: string,
  customEndpoint?: CustomEndpointCodexHeaderConfig,
) {
  const trimmedBaseUrl = trimTrailingSlashes(baseUrl.trim())
  if (customEndpoint?.api !== 'openai-responses') {
    return trimmedBaseUrl
  }

  return normalizeOpenAiResponsesBaseUrl(trimmedBaseUrl)
}

function normalizeOpenAiResponsesBaseUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl)
    const normalizedPath = normalizeOpenAiResponsesPath(url.pathname)
    url.pathname = normalizedPath
    return trimTrailingSlashes(url.toString())
  } catch {
    return baseUrl
  }
}

function normalizeOpenAiResponsesPath(pathname: string) {
  const path = trimTrailingSlashes(pathname)
  if (!path || path === '/') {
    return '/v1'
  }
  if (path === '/codex' || path === '/codex/responses') {
    return '/v1'
  }
  if (path.endsWith(RESPONSES_SUFFIX)) {
    return path.slice(0, -RESPONSES_SUFFIX.length) || '/v1'
  }
  return path
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '')
}

function readCompat(model: object): CodexResponsesCompat {
  const maybeCompat = 'compat' in model ? model.compat : undefined
  if (!isCompatRecord(maybeCompat)) {
    return {}
  }

  return maybeCompat
}

function isCompatRecord(value: unknown): value is CodexResponsesCompat {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function withCodexResponsesCompat<Model extends object>(
  model: Model,
  customEndpoint?: CustomEndpointCodexHeaderConfig,
) {
  if (!shouldSimulateCodexCliHeaders(customEndpoint)) {
    return model
  }

  return {
    ...model,
    compat: {
      ...readCompat(model),
      sendSessionIdHeader: true,
    },
  }
}
