import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { LibraryCharacterDTO } from '@/lib/dto'
import { db, schema } from '@/server/db'
import { newId, notFound, readJson, route } from '@/server/http'
import { copyImages } from '@/server/projects'

export const GET = route(async (): Promise<LibraryCharacterDTO[]> => {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.libraryCharacters)
    .orderBy(asc(schema.libraryCharacters.name))
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
})

/** Saves a project's character to the library, with its own copies of the images. */
export const POST = route(async (request): Promise<LibraryCharacterDTO> => {
  // The browser sends the name and description as shown, which may be newer than the saved ones.
  const { characterId, ...shown } = await readJson(
    request,
    z.object({
      characterId: z.string().max(100),
      name: z.string().max(100).optional(),
      description: z.string().max(2000).optional(),
    }),
  )
  const database = await db()
  const [character] = await database
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
  if (!character) notFound('That character')
  const id = newId()
  const images = await copyImages(character.images, `library/characters/${id}`)
  const [row] = await database
    .insert(schema.libraryCharacters)
    .values({
      id,
      name: shown.name ?? character.name,
      description: shown.description ?? character.description,
      images,
    })
    .returning()
  return { ...row, createdAt: row.createdAt.toISOString() }
})
