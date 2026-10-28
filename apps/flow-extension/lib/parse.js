// Reads a storyboard as Cutroom copies or downloads it (Script step → Storyboard → Copy all / .txt):
//
//   Scene 1  (0:00.0 – 0:04.1)
//   Narration: “Look at you right now…”
//   Attach reference images for: Cappy
//
//   Image prompt: A messy cartoon goblin…
//   Shot: medium shot.
//   Style: …
//   ────────────────
//
// Other lists work too: numbered blocks ("1." / "#1" / "Shot 1") or one prompt per paragraph.

const SEPARATOR = /^\s*[─━—=\-_*]{5,}\s*$/m
const HEADER = /^\s*(?:scene|shot|image|picture|frame|item|#)?\s*#?\s*(\d{1,4})\b[ \t]*[.):\-–]?/i
const RANGE = /(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*[–—-]\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)/

/** "1:02.4" → 62.4 seconds. */
export function seconds(timecode) {
  const parts = timecode.split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const unquote = (text) =>
  text
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .trim()

/** One block of text as a storyboard item, or null when it holds no prompt. */
function parseBlock(block, fallbackNumber) {
  const lines = block.split('\n')
  let number = null
  let range = null
  let narration = ''
  let cast = []
  const prompt = []
  let inPrompt = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      if (inPrompt) prompt.push('')
      continue
    }
    const header = number === null && !inPrompt ? HEADER.exec(line) : null
    if (header && /^\s*(scene|shot|image|picture|frame|item|#|\d)/i.test(line)) {
      number = Number(header[1])
      const times = RANGE.exec(line)
      if (times)
        range = { start: seconds(times[1]), end: seconds(times[2]), label: `${times[1]} – ${times[2]}` }
      const rest = line.slice(header[0].length).replace(RANGE, '').replace(/[()]/g, '').trim()
      // "1. A goblin in bed" — the prompt on the same line as the number.
      if (rest && !/^(narration|attach[^:]*|image prompt|prompt)\s*:/i.test(rest)) {
        prompt.push(rest)
        inPrompt = true
      }
      continue
    }
    const label =
      /^(narration|voice[- ]?over|script|attach reference images for|characters|image prompt|prompt)\s*:\s*(.*)$/i.exec(
        line,
      )
    if (label && !inPrompt) {
      const key = label[1].toLowerCase()
      if (key === 'image prompt' || key === 'prompt') {
        if (label[2].trim()) prompt.push(label[2].trim())
        inPrompt = true
      } else if (key === 'attach reference images for' || key === 'characters') {
        cast = label[2]
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      } else {
        narration = unquote(label[2])
      }
      continue
    }
    if (!range && !inPrompt) {
      const times = RANGE.exec(line)
      if (times && line.replace(RANGE, '').replace(/[()\s]/g, '') === '') {
        range = { start: seconds(times[1]), end: seconds(times[2]), label: `${times[1]} – ${times[2]}` }
        continue
      }
    }
    prompt.push(line)
    inPrompt = true
  }
  const text = prompt.join('\n').trim()
  if (!text) return null
  return { number: number ?? fallbackNumber, range, narration, cast, prompt: text }
}

/**
 * Every item in a storyboard text, in order: its number, time range, narration, the characters
 * to attach and the full prompt (with its Shot, Style and Format lines). Items without a number
 * are numbered after the one before.
 */
export function parseStoryboard(text) {
  const clean = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
  let blocks = clean.split(SEPARATOR)
  if (blocks.length < 2) {
    // No separators: start a new block at every numbered header ("Scene 3", "3.", "#3"), or else at
    // every blank line.
    const byHeader = clean.split(
      /\n(?=\s*(?:(?:scene|shot|image|picture|frame|item)\s*#?\s*\d+\b|#?\d{1,4}[.)]\s))/i,
    )
    blocks = byHeader.length > 1 ? byHeader : clean.split(/\n\s*\n/)
  }
  const items = []
  for (const block of blocks) {
    const previous = items[items.length - 1]
    const item = parseBlock(block, (previous?.number ?? 0) + 1)
    if (item) items.push(item)
  }
  return items
}
