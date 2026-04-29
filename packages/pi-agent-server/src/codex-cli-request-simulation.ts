import type { CustomEndpointApi } from '../../shared/src/config/llm-connections.ts';

export const CODEX_CLI_ORIGINATOR = 'codex_cli_rs';
export const CODEX_CLI_USER_AGENT = 'codex_cli_rs/0.125.0';

export const CODEX_CLI_REQUEST_HEADERS: Record<string, string> = {
  originator: CODEX_CLI_ORIGINATOR,
  'User-Agent': CODEX_CLI_USER_AGENT,
  'OpenAI-Beta': 'responses=experimental',
  accept: 'text/event-stream',
};

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];
type CustomEndpointRuntimeApi = Exclude<CustomEndpointApi, 'openai-codex-responses'> | 'openai-responses';

let restoreFetch: (() => void) | undefined;
let activeBaseUrl: string | undefined;

export function resolveCustomEndpointRuntimeApi(api: CustomEndpointApi): CustomEndpointRuntimeApi {
  return api === 'openai-codex-responses' ? 'openai-responses' : api;
}

export function shouldApplyCodexCliRequestHeaders(inputUrl: string, baseUrl: string): boolean {
  try {
    const target = new URL(inputUrl);
    const configuredBase = new URL(baseUrl.trim().replace(/\/+$/, ''));
    const configuredPath = configuredBase.pathname.replace(/\/+$/, '');
    const targetPath = target.pathname.replace(/\/+$/, '');
    return target.origin === configuredBase.origin
      && (configuredPath === '' || configuredPath === '/'
        ? targetPath.startsWith('/')
        : targetPath === configuredPath || targetPath.startsWith(`${configuredPath}/`));
  } catch {
    return false;
  }
}

export function applyCodexCliRequestHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  for (const [key, value] of Object.entries(CODEX_CLI_REQUEST_HEADERS)) {
    nextHeaders.set(key, value);
  }
  return nextHeaders;
}

export function rewriteCodexCliFetchInit(input: FetchInput, init: FetchInit, baseUrl: string): FetchInit {
  const inputUrl = resolveFetchInputUrl(input);
  if (!inputUrl || !shouldApplyCodexCliRequestHeaders(inputUrl, baseUrl)) {
    return init;
  }

  const nextInit: RequestInit = init ? { ...init } : {};
  nextInit.headers = applyCodexCliRequestHeaders(init?.headers ?? resolveFetchInputHeaders(input));
  return nextInit;
}

export function configureCodexCliRequestSimulation(baseUrl?: string): void {
  const nextBaseUrl = baseUrl?.trim() || undefined;
  if (activeBaseUrl === nextBaseUrl) return;

  restoreCodexCliRequestSimulation();
  activeBaseUrl = nextBaseUrl;
  if (!nextBaseUrl) return;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return;

  const wrappedFetch = Object.assign(
    (input: FetchInput, init?: FetchInit) => originalFetch(input, rewriteCodexCliFetchInit(input, init, nextBaseUrl)),
    { preconnect: originalFetch.preconnect.bind(originalFetch) },
  );

  globalThis.fetch = wrappedFetch;
  restoreFetch = () => {
    globalThis.fetch = originalFetch;
  };
}

export function restoreCodexCliRequestSimulation(): void {
  restoreFetch?.();
  restoreFetch = undefined;
  activeBaseUrl = undefined;
}

function resolveFetchInputUrl(input: FetchInput): string | undefined {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return undefined;
}

function resolveFetchInputHeaders(input: FetchInput): HeadersInit | undefined {
  if (typeof Request !== 'undefined' && input instanceof Request) return input.headers;
  return undefined;
}
