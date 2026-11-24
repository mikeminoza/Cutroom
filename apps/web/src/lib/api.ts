// Small fetch wrapper. Errors carry the server's plain-language message.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** The request never got an answer: offline, or the connection dropped. */
export const UNREACHABLE = "Couldn't reach Cutroom's server. Check your connection and try again."

/**
 * Plain words for a failed request that didn't answer with the app's own { error } (its routes
 * always do, server/http.ts): the host's own error page instead. A 504 there is Vercel stopping a
 * request that ran past its time limit (FUNCTION_INVOCATION_TIMEOUT).
 */
export function failureText(status: number): string {
  if (status === 504) {
    return 'The server stopped this because it ran past its time limit (5 minutes). Try again in a minute.'
  }
  if (status === 502 || status === 503) {
    return `The server couldn't answer just now (HTTP ${status}). Try again in a minute.`
  }
  return `Request failed (HTTP ${status}).`
}

/** Fetches, turning a request that never got an answer into an ApiError that says so. */
export async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    // Stopped on purpose: not a failure to explain.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(UNREACHABLE, 0)
  }
}

/** The ApiError for a response that isn't ok: the server's own message, or failureText's. */
export async function errorOf(res: Response): Promise<ApiError> {
  const data = await res.json().catch(() => null)
  return new ApiError(data?.error ?? failureText(res.status), res.status)
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await send(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth')) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
  }
  if (!res.ok) throw await errorOf(res)
  return (await res.json().catch(() => null)) as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
