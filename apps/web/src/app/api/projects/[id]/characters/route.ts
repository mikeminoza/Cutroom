import { db, schema } from '@/server/db'
import { newId, route } from '@/server/http'
import { getCharacters, getProjectRow, toCharacterDTO, touchProject } from '@/server/projects'

type Ctx = { params: Promise<{ id: string }> }

export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  await getProjectRow(id)
  const existing = await getCharacters(id)
  const database = await db()
  const [row] = await database
    .insert(schema.characters)
    .values({ id: newId(), projectId: id, name: '', description: '', images: [], position: existing.length })
    .returning()
  await touchProject(id)
  return toCharacterDTO(row)
})
