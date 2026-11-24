// Every Gemini call the web app makes, kept for Settings → AI speed: how long each kind of AI work
// takes and why calls fail, from the app's own records instead of Vercel's logs. The Gemini client
// (packages/shared/src/ai.ts) tells each call once it's done (onAiCall); kept 30 days.
import { type AiCallRecord, onAiCall } from '@cutroom/shared/ai'
import { desc, gte, lt } from 'drizzle-orm'
import { after } from 'next/server'
import type { AiSpeedDTO } from '@/lib/dto'
import { db, schema } from './db'

const KEEP_MS = 30 * 24 * 60 * 60_000

/** Saves one call. A record that can't be saved never fails the AI work it's about. */
async function save(call: AiCallRecord): Promise<void> {
  try {
    const database = await db()
    await database.insert(schema.aiCalls).values({ id: crypto.randomUUID(), ...call })
  } catch (error) {
    console.warn('[ai-calls] Not recorded:', error instanceof Error ? error.message : error)
  }
}

let listening = false

/**
 * Starts keeping every Gemini call this server makes. Each is saved after the request answers
 * (after(): Vercel keeps the request alive for it), or at once outside a request.
 */
export function keepAiCalls(): void {
  if (listening) return
  listening = true
  onAiCall((call) => {
    try {
      after(() => save(call))
    } catch {
      void save(call)
    }
  })
}

/**
 * The kind of work a call was, without what tells its parts apart: "storyboard part 3" is
 * "storyboard", "scene layers (part 2 of 4)" is "scene layers", "translation (es, fr)" is
 * "translation".
 */
export function kindOf(task: string): string {
  return task
    .replace(/ part \d+$/, '')
    .replace(/ \(part \d+ of \d+\)$/, '')
    .replace(/^(translation|title translation|subtitles) \(.*\)$/, '$1')
}

/** The middle value of some numbers (the higher of the two middle ones for an even count). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

const seconds = (ms: number) => Math.round(ms / 100) / 10

/** The last `days` days of Gemini calls: by kind of work, slowest typical first, and the 10 slowest calls. */
export async function aiSpeed(days = 7): Promise<AiSpeedDTO> {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.aiCalls)
    .where(gte(schema.aiCalls.createdAt, new Date(Date.now() - days * 24 * 60 * 60_000)))
    .orderBy(desc(schema.aiCalls.ms))
  const byKind = new Map<string, typeof rows>()
  for (const row of rows) {
    const kind = kindOf(row.task)
    byKind.set(kind, [...(byKind.get(kind) ?? []), row])
  }
  const kinds = [...byKind.entries()]
    .map(([task, calls]) => ({
      task,
      calls: calls.length,
      failed: calls.filter((c) => c.error).length,
      outOfTime: calls.filter((c) => c.error === 'timeout').length,
      typicalSeconds: seconds(median(calls.map((c) => c.ms))),
      slowestSeconds: seconds(Math.max(...calls.map((c) => c.ms))),
    }))
    .sort((a, b) => b.typicalSeconds - a.typicalSeconds)
  const slowest = rows.slice(0, 10).map((row) => ({
    task: row.task,
    model: row.model,
    seconds: seconds(row.ms),
    tries: row.tries,
    waitedSeconds: seconds(row.waitedMs),
    writtenTokens: row.writtenTokens,
    error: row.error,
    at: row.createdAt.toISOString(),
  }))
  return { days, kinds, slowest }
}

/** Drops calls older than 30 days (from the daily cron). Returns how many. */
export async function pruneAiCalls(): Promise<number> {
  const database = await db()
  const gone = await database
    .delete(schema.aiCalls)
    .where(lt(schema.aiCalls.createdAt, new Date(Date.now() - KEEP_MS)))
    .returning({ id: schema.aiCalls.id })
  return gone.length
}
