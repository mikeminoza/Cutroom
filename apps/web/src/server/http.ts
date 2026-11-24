import { AiError, withAiBudget } from '@cutroom/shared/ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAuthorized } from './auth'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function notFound(what = 'That item'): never {
  throw new HttpError(404, `${what} was not found.`)
}

export function badRequest(message: string): never {
  throw new HttpError(400, message)
}

/**
 * What a thrown error tells the browser: the HTTP status, and the message to show (with the AI's
 * error code when it's one). Unexpected errors and AI failures are logged too.
 */
export function describeError(error: unknown): { status: number; body: { error: string; code?: string } } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message } }
  if (error instanceof AiError) {
    // Logged too, so failed AI calls show up in the server logs and not only in the browser.
    console.error(`AI request failed (${error.code}): ${error.message}`)
    const status =
      error.code === 'rate_limited' || error.code === 'daily_limit'
        ? 429
        : error.code === 'missing_key'
          ? 400
          : error.code === 'billing'
            ? 402
            : error.code === 'busy'
              ? 503
              : error.code === 'timeout'
                ? 504
                : 502
    return { status, body: { error: error.message, code: error.code } }
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    return { status: 400, body: { error: `${issue.path.join('.') || 'Request'}: ${issue.message}` } }
  }
  console.error(error)
  return { status: 500, body: { error: error instanceof Error ? error.message : 'Something went wrong.' } }
}

export function toErrorResponse(error: unknown): NextResponse {
  const { status, body } = describeError(error)
  return NextResponse.json(body, { status })
}

type Handler<C> = (request: Request, context: C) => Promise<Response | unknown>

/**
 * Wraps a route handler: checks the login session, turns thrown errors into JSON responses, and
 * gives the whole request one AI budget (withAiBudget), from when it came in: Vercel stops a request
 * 300 s after it starts, however many Gemini calls it makes, and counts what it streams or does
 * after answering (after()) too.
 */
export function route<C>(handler: Handler<C>, options: { public?: boolean } = {}) {
  return (request: Request, context: C): Promise<Response> =>
    withAiBudget(async () => {
      try {
        if (!options.public && !(await isAuthorized(request))) {
          return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
        }
        const result = await handler(request, context)
        if (result instanceof Response) return result
        return NextResponse.json(result ?? { ok: true })
      } catch (error) {
        return toErrorResponse(error)
      }
    })
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await request.json().catch(() => badRequest('Send a JSON body.'))
  return schema.parse(body)
}

export function newId(): string {
  return crypto.randomUUID()
}
