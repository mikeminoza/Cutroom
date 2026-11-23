// What a Cutroom project sends (Images step → "Make in Flow", or the side panel asking for the
// project open in Cutroom), as the side panel uses it: the scenes as storyboard items that know
// which Cutroom scene they belong to, the character whose pictures go along with them, and what
// the panel offers to do for the project.

/**
 * The project's scenes as storyboard items. Cutroom says which scenes already have a picture:
 * those start as done ("Make again" makes a new one). Your choices on a scene (character, which
 * scene to match) are kept when the same project is sent again with the same prompt.
 */
export function itemsFromCutroom(incoming, previous = []) {
  const before = new Map(
    previous.filter((item) => item.sceneId).map((item) => [`${item.sceneId}|${item.prompt}`, item]),
  )
  const items = []
  for (const scene of incoming?.scenes ?? []) {
    const number = Number(scene.number)
    const prompt = String(scene.prompt ?? '').trim()
    if (!prompt || !Number.isInteger(number) || number < 1) continue
    const old = before.get(`${scene.id}|${prompt}`)
    const range =
      scene.range && Number.isFinite(scene.range.start) && Number.isFinite(scene.range.end)
        ? { start: scene.range.start, end: scene.range.end, label: String(scene.range.label ?? '') }
        : null
    items.push({
      number,
      sceneId: String(scene.id),
      range,
      narration: String(scene.narration ?? ''),
      cast: Array.isArray(scene.cast) ? scene.cast.map(String).filter(Boolean) : [],
      prompt,
      status: scene.hasImage ? 'done' : 'todo',
      files: scene.hasImage ? ['in Cutroom'] : [],
      error: '',
      character: old?.character ?? 'auto',
      related: old?.related ?? 'auto',
    })
  }
  return items
}

/**
 * The character whose pictures go with the scenes: of the project's characters with pictures, the
 * one the most scenes call for (the first on a tie). Null when none has a picture.
 */
export function mainCharacter(incoming) {
  const counts = new Map()
  for (const scene of incoming?.scenes ?? []) {
    for (const name of scene.cast ?? []) {
      const key = String(name).trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const pictured = (incoming?.characters ?? []).filter(
    (character) => character?.name && character.images?.some((image) => image?.dataUrl),
  )
  if (pictured.length === 0) return null
  const score = (character) => counts.get(character.name.trim().toLowerCase()) ?? 0
  const best = pictured.reduce((winner, other) => (score(other) > score(winner) ? other : winner))
  return {
    name: best.name.trim(),
    looks: String(best.description ?? '').trim(),
    images: best.images
      .filter((image) => image?.dataUrl)
      .slice(0, 3)
      .map((image, i) => ({
        name: image.name || `${best.name.trim()}-${i + 1}.png`,
        type: image.type || 'image/png',
        dataUrl: image.dataUrl,
      })),
  }
}

/**
 * The project open in Cutroom: of the Cutroom tabs the extension knows ({ tabId, origin,
 * projectId, at } by tab), the one on a project page you looked at last. Null when none is.
 */
export function currentProject(tabs) {
  let latest = null
  for (const tab of Object.values(tabs ?? {})) {
    if (tab?.projectId && (!latest || tab.at > latest.at)) latest = tab
  }
  return latest
}

const pictures = (n) => `${n} ${n === 1 ? 'picture' : 'pictures'}`

/**
 * What the side panel offers for the project open in Cutroom, from what Cutroom says about it
 * ({ hasScript, scenes, missing }): the pictures its scenes are missing; for a script not split
 * into scenes yet, the split first (only scenes have picture prompts); otherwise nothing to make.
 */
export function projectOffer({ hasScript, scenes, missing }) {
  if (scenes === 0 && !hasScript) {
    return { action: null, text: 'No script yet. Write it on the Script step in Cutroom first.' }
  }
  if (scenes === 0) {
    return {
      action: 'split',
      label: 'Split into scenes with AI',
      text: 'Its script isn’t split into scenes yet. Splitting it with AI gives each scene a picture prompt.',
    }
  }
  if (missing === 0) {
    return {
      action: 'load',
      label: 'Load its scenes',
      text: `All ${scenes} scenes have a picture. Load them to make one again.`,
    }
  }
  return {
    action: 'make',
    label: `Make ${pictures(missing)}`,
    text: `${scenes} scenes, ${missing} without a picture. Each one goes straight onto its scene in Cutroom.`,
  }
}

/** "https://cutroom.example.com/projects/1" → "https://cutroom.example.com"; null when not a web address. */
export function siteOrigin(address) {
  const text = String(address ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)
    return /^https?:$/.test(url.protocol) && url.hostname ? url.origin : null
  } catch {
    return null
  }
}
