import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '@/server/db'
import { newId, notFound, route } from '@/server/http'
import { copyImages, getCharacters, getProjectRow, toCharacterDTO, touchProject } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

/** Adds an empty character, or a copy of one from the library (`libraryId`). */
export const POST = route(async (request, { params }: Ctx) => {
  const { id } = await params
  // The body is optional: an empty request adds an empty character, as it always did.
  const body = z
    .object({ libraryId: z.string().max(100).optional() })
    .parse(await request.json().catch(() => ({})))
  await getProjectRow(id)
  const existing = await getCharacters(id)
  const database = await db()
  let name = ''
  let description = ''
  let images: { url: string; key: string }[] = []
  if (body.libraryId) {
    const [saved] = await database
      .select()
      .from(schema.libraryCharacters)
      .where(eq(schema.libraryCharacters.id, body.libraryId))
    if (!saved) notFound('That library character')
    name = saved.name
    description = saved.description
    images = await copyImages(saved.images, `projects/${id}/characters`)
  }
  const [row] = await database
    .insert(schema.characters)
    .values({ id: newId(), projectId: id, name, description, images, position: existing.length })
    .returning()
  await touchProject(id)
  return toCharacterDTO(row)
})
