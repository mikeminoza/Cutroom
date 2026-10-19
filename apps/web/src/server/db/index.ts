// Database: Neon Postgres when DATABASE_URL is set (production),
// otherwise an embedded Postgres (PGlite) stored in .data/pglite for local development.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { repoRoot } from '@cutroom/shared/storage'
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import { migrations } from './migrations'
import * as schema from './schema'

export type Db = PgliteDatabase<typeof schema>

const cache = globalThis as unknown as { __cutroomDb?: Promise<Db> }

export function db(): Promise<Db> {
  if (!cache.__cutroomDb) {
    cache.__cutroomDb = create().catch((error) => {
      cache.__cutroomDb = undefined
      throw error
    })
  }
  return cache.__cutroomDb
}

async function create(): Promise<Db> {
  const url = process.env.DATABASE_URL
  if (url) {
    const client = neon(url)
    await migrate(
      async (statement) => {
        await client.query(statement)
      },
      async () => (await client.query('SELECT tag FROM "__migrations"')).map((r) => String(r.tag)),
    )
    return drizzleNeon({ client, schema }) as unknown as Db
  }

  const [{ PGlite }, { drizzle }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ])
  const dir = process.env.PGLITE_DIR || path.join(repoRoot(), '.data', 'pglite')
  mkdirSync(dir, { recursive: true })
  const client = new PGlite(dir)
  await client.waitReady
  await migrate(
    async (statement) => {
      await client.exec(statement)
    },
    async () =>
      (await client.query<{ tag: string }>('SELECT tag FROM "__migrations"')).rows.map((r) => r.tag),
  )
  return drizzle({ client, schema })
}

const DUPLICATE = /already exists|42P07|42710|42701/i

async function migrate(exec: (sql: string) => Promise<void>, applied: () => Promise<string[]>) {
  await exec(
    'CREATE TABLE IF NOT EXISTS "__migrations" ("tag" text PRIMARY KEY, "applied_at" timestamptz DEFAULT now())',
  )
  const done = new Set(await applied())
  for (const migration of migrations) {
    if (done.has(migration.tag)) continue
    for (const statement of migration.statements) {
      try {
        await exec(statement)
      } catch (error) {
        // Another instance may be migrating at the same moment.
        if (!DUPLICATE.test(String((error as Error).message))) throw error
      }
    }
    await exec(`INSERT INTO "__migrations" ("tag") VALUES ('${migration.tag}') ON CONFLICT DO NOTHING`)
  }
}

export { schema }
