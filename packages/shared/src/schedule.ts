// Posting slots ("Mon, Wed, Fri at 18:00") in the user's time zone, turned into real instants.
import type { PostingSlot } from './types'

function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - instant.getTime()) / 60000)
}

/** Wall-clock time in a time zone -> UTC instant. */
export function zonedToUtc(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, hour, minute)
  let offset = zoneOffsetMinutes(new Date(guess), timeZone)
  let result = guess - offset * 60000
  const corrected = zoneOffsetMinutes(new Date(result), timeZone)
  if (corrected !== offset) {
    offset = corrected
    result = guess - offset * 60000
  }
  return new Date(result)
}

function zonedDate(instant: Date, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: weekdays.indexOf(get('weekday')),
  }
}

/** YouTube needs the publish time to be in the future when the upload finishes. */
export const MIN_LEAD_MINUTES = 90

export function upcomingSlots(slots: PostingSlot[], timeZone: string, from: Date, weeks = 6): Date[] {
  if (slots.length === 0) return []
  const earliest = from.getTime() + MIN_LEAD_MINUTES * 60000
  const result: Date[] = []
  const start = zonedDate(from, timeZone)
  for (let offset = 0; offset < weeks * 7; offset++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + offset, 12))
    const weekday = day.getUTCDay()
    for (const slot of slots) {
      if (slot.day !== weekday) continue
      const [hour, minute] = slot.time.split(':').map(Number)
      const instant = zonedToUtc(
        day.getUTCFullYear(),
        day.getUTCMonth() + 1,
        day.getUTCDate(),
        hour,
        minute,
        timeZone,
      )
      if (instant.getTime() >= earliest) result.push(instant)
    }
  }
  return result.sort((a, b) => a.getTime() - b.getTime())
}

export function nextFreeSlot(
  slots: PostingSlot[],
  timeZone: string,
  taken: Date[],
  from = new Date(),
): Date | null {
  const takenTimes = taken.map((t) => t.getTime())
  for (const slot of upcomingSlots(slots, timeZone, from)) {
    const clash = takenTimes.some((t) => Math.abs(t - slot.getTime()) < 60000)
    if (!clash) return slot
  }
  return null
}

export function formatSlot(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant)
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
