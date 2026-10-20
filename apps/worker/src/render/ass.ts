// Builds the ASS subtitle file that ffmpeg burns into the video. Pure: no I/O, no clock.
// Chunks come from chunkCaptions() so the burned captions match the browser preview.
import { type CaptionChunk, OVERLAY_FADE_SECONDS, type Overlay } from '@cutroom/shared/captions'
import type { CaptionStyle, VideoFormat } from '@cutroom/shared/types'

/** Kodak yellow, the colour of the word being spoken in 'highlight' mode. */
export const HIGHLIGHT_HEX = '#FFB800'

export interface AssOptions {
  width: number
  height: number
  format: VideoFormat
  style: CaptionStyle
}

export interface CaptionLayout {
  fontSize: number
  outline: number
  shadow: number
  blur: number
  alignment: number
  marginL: number
  marginR: number
  marginV: number
  /** Anchor point for \an5\pos(); null when the style's alignment + margins place the text. */
  pos: { x: number; y: number } | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function captionLayout(width: number, height: number, format: VideoFormat): CaptionLayout {
  // Outline/shadow are specified at 1080p and scaled by the short side.
  const scale = Math.min(width, height) / 1080
  const base = {
    outline: round1(4 * scale),
    shadow: round1(2.5 * scale),
    blur: round1(1.2 * scale),
    marginL: Math.round(width * 0.08),
    marginR: Math.round(width * 0.08),
  }
  if (format === 'portrait') {
    // \an5 centres the block on the anchor, so 1- and 2-line captions both sit around 68%.
    return {
      ...base,
      fontSize: Math.round(height * 0.042),
      alignment: 5,
      marginV: 0,
      pos: { x: Math.round(width / 2), y: Math.round(height * 0.68) },
    }
  }
  return {
    ...base,
    fontSize: Math.round(height * 0.052),
    alignment: 2,
    marginV: Math.round(height * 0.08),
    pos: null,
  }
}

export interface OverlayLayout {
  fontSize: number
  /** With BorderStyle 3 the outline width is the padding of the box around the text. */
  padding: number
  marginV: number
  marginH: number
}

/** On-screen text sits at the top, clear of the captions (bottom on video, 68% on Shorts). */
export function overlayLayout(width: number, height: number, format: VideoFormat): OverlayLayout {
  const fontSize = format === 'portrait' ? Math.round(height * 0.032) : Math.round(height * 0.056)
  return {
    fontSize,
    padding: Math.max(2, Math.round(fontSize * 0.32)),
    // Shorts: below YouTube's top bar. Video: a little in from the edge.
    marginV: Math.round(height * (format === 'portrait' ? 0.13 : 0.07)),
    marginH: Math.round(width * 0.08),
  }
}

/** '#RRGGBB' -> ASS '&HAABBGGRR' (style lines). */
export function assColor(hex: string, alpha = 0): string {
  const clean = hex.replace('#', '')
  const [r, g, b] = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)]
  const a = alpha.toString(16).padStart(2, '0')
  return `&H${a}${b}${g}${r}`.toUpperCase()
}

/** '#RRGGBB' -> override-tag colour '&HBBGGRR&'. */
function tagColor(hex: string): string {
  return `${assColor(hex).slice(0, 2)}${assColor(hex).slice(4)}&`
}

/** Seconds -> 'h:mm:ss.cc'. */
export function assTime(seconds: number): string {
  return formatCentis(toCentis(seconds))
}

function toCentis(seconds: number): number {
  return Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 100))
}

function formatCentis(total: number): string {
  const h = Math.floor(total / 360_000)
  const m = Math.floor((total % 360_000) / 6000)
  const s = Math.floor((total % 6000) / 100)
  const cs = total % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/**
 * Makes caption text literal. libass reads `{...}` as override tags and `\N`, `\n`, `\h`,
 * `\{`, `\}` as escapes, so braces become `\{` `\}`, and a backslash gets a WORD JOINER
 * (U+2060, invisible) after it so it can never start an escape. Newlines become `\N`.
 */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\⁠')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N')
}

function header(options: AssOptions, layout: CaptionLayout): string {
  const white = assColor('#FFFFFF')
  const black = assColor('#000000')
  const shadow = assColor('#000000', 0x70)
  const box = overlayLayout(options.width, options.height, options.format)
  // BorderStyle 3 draws an opaque box in the outline colour; the ink colour at ~80% opacity.
  const overlayStyle = [
    'Overlay',
    'Arial',
    box.fontSize,
    white,
    white,
    assColor('#171C26', 0x30),
    assColor('#000000', 0xff),
    -1,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    3,
    box.padding,
    0,
    8,
    box.marginH,
    box.marginH,
    box.marginV,
    1,
  ].join(',')
  // Name, Fontname, Fontsize, Primary, Secondary, Outline, Back, Bold, Italic, Underline, StrikeOut,
  // ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  const style = [
    'Caption',
    'Arial',
    layout.fontSize,
    white,
    white,
    black,
    shadow,
    -1,
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    1,
    layout.outline,
    layout.shadow,
    layout.alignment,
    layout.marginL,
    layout.marginR,
    layout.marginV,
    1,
  ].join(',')
  return [
    '[Script Info]',
    '; Generated by Cutroom',
    'ScriptType: v4.00+',
    `PlayResX: ${options.width}`,
    `PlayResY: ${options.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style}`,
    `Style: ${overlayStyle}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')
}

function dialogue(start: number, end: number, text: string): string {
  return `Dialogue: 0,${formatCentis(start)},${formatCentis(end)},Caption,,0,0,0,,${text}`
}

function overlayEvent(overlay: Overlay): string | null {
  const start = toCentis(overlay.start)
  const end = toCentis(overlay.end)
  const text = escapeAssText(overlay.text.trim())
  if (end <= start || !text) return null
  const fadeMs = overlay.end - overlay.start >= OVERLAY_FADE_SECONDS * 3 ? OVERLAY_FADE_SECONDS * 1000 : 0
  const tags = fadeMs ? `{\\fad(${fadeMs},${fadeMs})}` : ''
  // Layer 1: drawn above the captions if the two ever meet.
  return `Dialogue: 1,${formatCentis(start)},${formatCentis(end)},Overlay,,0,0,0,,${tags}${text}`
}

/**
 * The full .ass file. 'line' = one white event per chunk. 'highlight' = one event per word
 * inside each chunk, back to back (each ends exactly where the next starts, so there is no
 * flicker), with the spoken word in Kodak yellow. 'off' = no caption events.
 * On-screen text overlays are added whatever the caption style.
 */
export function buildAss(chunks: CaptionChunk[], options: AssOptions, overlays: Overlay[] = []): string {
  const layout = captionLayout(options.width, options.height, options.format)
  const lines = [header(options, layout)]
  for (const overlay of overlays) {
    const event = overlayEvent(overlay)
    if (event) lines.push(event)
  }
  if (options.style === 'off') return `${lines.join('\n')}\n`

  const tags = layout.pos ? `\\an5\\pos(${layout.pos.x},${layout.pos.y})` : ''
  const prefix = `{${tags}\\blur${layout.blur}}`
  const yellow = `{\\1c${tagColor(HIGHLIGHT_HEX)}}`
  const white = `{\\1c${tagColor('#FFFFFF')}}`

  const sorted = [...chunks].filter((c) => c.words.length > 0).sort((a, b) => a.start - b.start)
  sorted.forEach((chunk, i) => {
    const start = toCentis(chunk.start)
    const next = sorted[i + 1]
    // Never overlap the next chunk: libass would stack both on screen.
    const end = Math.min(toCentis(chunk.end), next ? toCentis(next.start) : Number.POSITIVE_INFINITY)
    if (end <= start) return
    const texts = chunk.words.map((w) => escapeAssText(w.text.trim()))

    if (options.style === 'line') {
      lines.push(dialogue(start, end, prefix + texts.join(' ')))
      return
    }

    // Boundaries are shared between neighbouring events, so they tile [start, end) exactly.
    const bounds = [start]
    for (let j = 1; j < chunk.words.length; j++) {
      const t = Math.min(end, Math.max(bounds[j - 1], toCentis(chunk.words[j].start)))
      bounds.push(t)
    }
    bounds.push(end)
    for (let j = 0; j < texts.length; j++) {
      if (bounds[j + 1] <= bounds[j]) continue
      const text = texts
        .map((t, k) => (k === j ? `${yellow}${t}${k < texts.length - 1 ? white : ''}` : t))
        .join(' ')
      lines.push(dialogue(bounds[j], bounds[j + 1], prefix + text))
    }
  })
  return `${lines.join('\n')}\n`
}
