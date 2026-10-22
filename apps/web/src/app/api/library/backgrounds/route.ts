import { isStoredUnder } from '@cutroom/shared/storage'
import { asc } from 'drizzle-orm'
import { z } from 'zod'
import type { LibraryBackgroundDTO } from '@/lib/dto'
import { db, schema } from '@/server/db'
import type { LibraryBackgroundRow } from '@/server/db/schema'
import { badRequest, readJson, route } from '@/server/http'

const toBackgroundDTO = (row: LibraryBackgroundRow): LibraryBackgroundDTO => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
})

export const GET = route(async (): Promise<LibraryBackgroundDTO[]> => {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.libraryBackgrounds)
    .orderBy(asc(schema.libraryBackgrounds.name))
  return rows.map(toBackgroundDTO)
})

/** Adds a background whose picture the browser has uploaded to `library/backgrounds/<id>`. */
export const POST = route(async (request): Promise<LibraryBackgroundDTO> => {
  const body = await readJson(
    request,
    z.object({
      id: z.string().uuid(),
      name: z.string().trim().max(100).default(''),
      url: z.string().max(2000),
      key: z.string().max(500),
    }),
  )
  if (!isStoredUnder(body.url, `library/backgrounds/${body.id}`)) {
    badRequest('Upload the picture to this background first.')
  }
  const database = await db()
  const [row] = await database.insert(schema.libraryBackgrounds).values(body).returning()
  return toBackgroundDTO(row)
})
