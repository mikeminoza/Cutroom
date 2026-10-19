import { type GoogleProvider, hasGoogleClient } from '@cutroom/shared/google'
import { eq } from 'drizzle-orm'
import { db, schema } from './db'

export async function getConnection(provider: GoogleProvider) {
  const database = await db()
  const [row] = await database
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.provider, provider))
  return row ?? null
}

export async function saveConnection(
  provider: GoogleProvider,
  data: { refreshToken: string; email: string | null; label: string | null; scope: string },
) {
  const database = await db()
  await database
    .insert(schema.connections)
    .values({ provider, ...data })
    .onConflictDoUpdate({ target: schema.connections.provider, set: { ...data, createdAt: new Date() } })
}

export async function deleteConnection(provider: GoogleProvider) {
  const database = await db()
  await database.delete(schema.connections).where(eq(schema.connections.provider, provider))
}

export interface ConnectionSummary {
  connected: boolean
  email: string | null
  label: string | null
  since: string | null
}

export async function connectionSummaries(): Promise<Record<GoogleProvider, ConnectionSummary>> {
  const database = await db()
  const rows = await database.select().from(schema.connections)
  const summary = (provider: GoogleProvider): ConnectionSummary => {
    const row = rows.find((r) => r.provider === provider)
    return {
      connected: Boolean(row),
      email: row?.email ?? null,
      label: row?.label ?? null,
      since: row?.createdAt.toISOString() ?? null,
    }
  }
  return { youtube: summary('youtube'), drive: summary('drive') }
}

export { hasGoogleClient }
