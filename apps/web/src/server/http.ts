import { AiError } from '@cutroom/shared/ai'
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

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof AiError) {
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
    return NextResponse.json({ error: error.message, code: error.code }, { status })
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    return NextResponse.json(
      { error: `${issue.path.join('.') || 'Request'}: ${issue.message}` },
      { status: 400 },
    )
  }
  console.error(error)
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return NextResponse.json({ error: message }, { status: 500 })
}

type Handler<C> = (request: Request, context: C) => Promise<Response | unknown>

/** Wraps a route handler: checks the login session, turns thrown errors into JSON responses. */
export function route<C>(handler: Handler<C>, options: { public?: boolean } = {}) {
  return async (request: Request, context: C): Promise<Response> => {
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
  }
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await request.json().catch(() => badRequest('Send a JSON body.'))
  return schema.parse(body)
}

export function newId(): string {
  return crypto.randomUUID()
}
