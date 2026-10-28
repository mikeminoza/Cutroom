// What each storyboard item becomes before it goes to Flow: which pictures go with it (your
// character, an earlier related scene), the lines added to its prompt, and the file it saves to.

/**
 * The protagonist: pictures that show them get the character reference. Other characters ("a
 * brain character", "a smug billionaire", "tiny janitors") don't; each scene can be switched by hand.
 */
const PROTAGONIST =
  /\b(the main character|stick[ -]?figures?|stick runner|figure|person|man|woman|guy|girl|boy|human|someone|zombie|goblin|you|yourself|narrator)\b/i

/** Anyone with a body, or a body part (even a lone hand), gets the anatomy line. */
const BODIES =
  /\b(people|men|women|kids?|child(ren)?|crowd|characters?|janitors?|billionaires?|runners?|zombies?|hands?|fists?|feet|foot|fingers?|arms?|legs?)\b/i

/** Words that describe the look of a picture rather than what is in it: not used to match scenes. */
const NOT_CONTENT = new Set(
  `a an the and or of in on at to with without into onto over under from by for as is are its it
  their they them his her he she this that these those then than there here very
  shot medium close wide establishing top-down style format widescreen vertical image picture
  crude crudely drawn doodle doodles cartoon simple minimal minimalist bold thick shaky black
  outlines flat earth-tone pastel fills cream off-white background backgrounds hand-lettered
  sans-serif text arrows pointing loser winner character states captions logos watermarks
  stick figure figures person tiny giant huge large small little big one two three next beside
  around above below behind front left right center middle showing looking standing sitting
  holding making getting being something someone everything`.split(/\s+/),
)

/** The first paragraph of a prompt: what is in the picture (Shot, Style and Format lines left out). */
export function subject(prompt) {
  return prompt
    .split('\n')
    .filter((line) => !/^(shot|style|format|anatomy)\s*:/i.test(line.trim()))
    .join(' ')
    .trim()
}

/** The words that say what is in a picture, singular, for matching related scenes. */
export function keywords(prompt) {
  const words = subject(prompt)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 4 && !NOT_CONTENT.has(w))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  return new Set(words)
}

/**
 * The earlier item a picture should match, if any: the one sharing the most of what is in the
 * picture (at least 3 words, and a fifth of them), nearer ones winning a tie. Returns its index.
 */
export function relatedIndex(items, index) {
  const own = keywords(items[index].prompt)
  let best = null
  let bestScore = 0
  for (let i = index - 1; i >= 0; i--) {
    const other = keywords(items[i].prompt)
    let shared = 0
    for (const word of own) if (other.has(word)) shared++
    const union = own.size + other.size - shared
    const score = union ? shared / union : 0
    if (shared >= 3 && score >= 0.2 && score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best
}

/** Should this item get the character's pictures: it names the character, or shows a person. */
export function wantsCharacter(item, character) {
  if (!character) return false
  const name = character.name?.trim().toLowerCase()
  if (
    name &&
    (item.cast.some((c) => c.toLowerCase() === name) || subject(item.prompt).toLowerCase().includes(name))
  )
    return true
  return PROTAGONIST.test(subject(item.prompt))
}

/**
 * The prompt sent to Flow: the storyboard's own, then what the attached pictures are for, normal
 * anatomy when there are bodies, and "No text" softened when the picture asks for words.
 */
export function shapePrompt(item, options) {
  const { character = null, withCharacter = false, related = null, anatomy = true } = options
  const lines = item.prompt.split('\n')
  const extra = []
  if (withCharacter && character) {
    // A picture of them goes along (attached, or saved in Flow and named with an @ mention).
    const pictured = Boolean(character.pictured || character.mention?.trim())
    const who =
      character.mention?.trim() ||
      character.name?.trim() ||
      (pictured ? 'the character in the attached reference picture' : 'the main character')
    const looks = character.description?.trim()
      ? ` (${character.description.trim().replace(/[.\s]+$/, '')})`
      : ''
    extra.push(
      pictured
        ? `Main character: ${who}${looks}. Any person in this picture is this character: draw them exactly like the reference picture, with the same face, body, proportions, colours and outfit.`
        : `Main character: ${who}${looks}. Any person in this picture is this character, drawn the same way in every picture.`,
    )
  }
  if (related) {
    extra.push(
      `Continuity: this picture follows scene ${related.number}, attached. Keep everything it shares with that picture (place, objects, character) looking the same.`,
    )
  }
  const text = item.prompt
  if (
    anatomy &&
    !/anatomy\s*:/i.test(text) &&
    (PROTAGONIST.test(subject(text)) || BODIES.test(subject(text)))
  ) {
    extra.push(
      'Anatomy: every person or character has one head, two arms, two hands with five fingers and two legs, in a simple, clear pose.',
    )
  }
  // Put the additions before the Style and Format lines, so the subject stays first.
  const tail = lines.findIndex((line) => /^(style|format)\s*:/i.test(line.trim()))
  const head = tail >= 0 ? lines.slice(0, tail) : lines
  let rest = tail >= 0 ? lines.slice(tail) : []
  // "No text" contradicts a picture or style that asks for words (a label, a sign, lettering).
  const style = rest.find((line) => /^style\s*:/i.test(line.trim())) ?? ''
  if (WORDS.test(subject(text)) || WORDS.test(style)) {
    rest = rest.map((line) =>
      line.replace(
        /No text, captions, logos or watermarks in the image\./i,
        'No captions, logos or watermarks; any words in the picture are only the ones described above, spelled exactly.',
      ),
    )
  }
  return [...head, ...extra, ...rest]
    .join('\n')
    .replace(/\.\.(\s|$)/g, '.$1')
    .trim()
}

/** The prompt or style asks for words in the picture. */
const WORDS =
  /\b(text|letters?|lettered|lettering|words?|reading|spell(s|ed|ing)?|label(l?ed)?|signs?|titles?)\b/i

/** "scene-007.png" for the first picture of item 7, "scene-007b.png" for its second, and so on. */
export function fileName(number, variant = 0, options = {}) {
  const { prefix = 'scene-', pad = 3, extension = 'png' } = options
  const letter = variant > 0 ? String.fromCharCode(97 + variant) : ''
  return `${prefix}${String(number).padStart(pad, '0')}${letter}.${extension}`
}

/** A folder name from the storyboard's file name: "why-you-wake-up-storyboard (1).txt" → "why-you-wake-up". */
export function folderName(fileName) {
  return (
    String(fileName ?? '')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/\s*\(\d+\)$/, '')
      .replace(/-?storyboard$/i, '')
      .replace(/[^\w\- ]+/g, '')
      .replace(/-+$/, '')
      .trim() || 'storyboard'
  )
}

/** The file extension for an image type. */
export function extensionFor(mime) {
  if (/jpe?g/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  return 'png'
}
