import { suggestPoses } from '@cutroom/shared/ai'
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '@/server/db'
import { notFound, route } from '@/server/http'
import { getSettings } from '@/server/settings'

// Gemini reads several scripts: the Hobby plan allows 300 s with Fluid compute.
export const maxDuration = 300

type Ctx = { params: Promise<{ id: string }> }

/**
 * The poses a Library character is missing, from what the newest scripts make them do, each
 * with a prompt to draw or generate it.
 */
export const POST = route(async (_request, { params }: Ctx) => {
  const { id } = await params
  const database = await db()
  const [character] = await database
    .select()
    .from(schema.libraryCharacters)
    .where(eq(schema.libraryCharacters.id, id))
  if (!character) notFound('That character')
  const { niche } = await getSettings()
  const recent = (
    await database
      .select({ script: schema.projects.script })
      .from(schema.projects)
      .orderBy(desc(schema.projects.updatedAt))
      .limit(20)
  )
    .map((p) => p.script)
    .filter((script) => script.trim())
  // Scripts that feature the character tell the most; without any, the newest ones.
  const name = character.name.trim().toLowerCase()
  const featuring = name ? recent.filter((script) => script.toLowerCase().includes(name)) : []
  const suggestions = await suggestPoses({
    character: { name: character.name.trim() || 'The character', description: character.description },
    artStyle: niche.artStyle,
    niche: [niche.description, niche.narration].filter((s) => s.trim()).join(' '),
    have: character.poses.map((p) => p.name).filter((n) => n.trim()),
    scripts: (featuring.length ? featuring : recent).slice(0, 6),
  })
  return { suggestions }
})
