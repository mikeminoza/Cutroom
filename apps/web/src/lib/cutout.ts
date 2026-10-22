// Cut-outs for poses, made in the browser: a plain background (white, or any flat colour) around
// the character becomes transparent, and empty margins are trimmed so the pose stands on the
// bottom edge of its picture. Image tools rarely make transparent pictures; this makes any
// picture drawn on a plain background usable as a pose. Free, and nothing is sent anywhere.

/** How far a pixel may be from the background colour (largest channel difference) and still be background. */
const TOLERANCE = 38
/** Alpha below this counts as empty when trimming. */
const EMPTY = 8

function loadBitmap(file: File): Promise<ImageBitmap | null> {
  return createImageBitmap(file).catch(() => null)
}

/**
 * Returns the picture with its plain background removed and its empty margins trimmed, as PNG,
 * or the file itself when there is nothing to do (or the background isn't plain, like a photo).
 */
export async function cutOut(file: File): Promise<File> {
  if (!/^image\/(png|webp|jpeg)$/.test(file.type)) return file
  const bitmap = await loadBitmap(file)
  if (!bitmap) return file
  const { width: w, height: h } = bitmap
  if (w < 2 || h < 2 || w * h > 16_000_000) return file
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0)
  const image = ctx.getImageData(0, 0, w, h)
  const d = image.data

  let removed = 0
  const edges: number[] = []
  for (let x = 0; x < w; x++) edges.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) edges.push(y * w, y * w + w - 1)
  const transparentEdge = edges.some((p) => d[p * 4 + 3] < 250)
  if (!transparentEdge) {
    const corners = [0, w - 1, (h - 1) * w, h * w - 1]
    const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((n, p) => n + d[p * 4 + c], 0) / 4))
    const far = (p: number) =>
      Math.max(Math.abs(d[p * 4] - bg[0]), Math.abs(d[p * 4 + 1] - bg[1]), Math.abs(d[p * 4 + 2] - bg[2]))
    // A plain background has the same colour in every corner; a photo doesn't.
    if (corners.some((p) => far(p) > TOLERANCE)) return file
    // Flood the background in from the edges, so the same colour inside the character (the
    // whites of the eyes) stays.
    const seen = new Uint8Array(w * h)
    const queue = new Int32Array(w * h)
    let head = 0
    let tail = 0
    const visit = (p: number) => {
      if (!seen[p] && far(p) <= TOLERANCE) {
        seen[p] = 1
        queue[tail++] = p
      }
    }
    for (const p of edges) visit(p)
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      d[p * 4 + 3] = 0
      if (x > 0) visit(p - 1)
      if (x < w - 1) visit(p + 1)
      if (p >= w) visit(p - w)
      if (p < w * (h - 1)) visit(p + w)
    }
    removed = tail
    // Soften the outline: pixels next to the background that are partly its colour fade partly.
    for (let p = 0; p < w * h; p++) {
      if (seen[p]) continue
      const x = p % w
      const touches =
        (x > 0 && seen[p - 1]) ||
        (x < w - 1 && seen[p + 1]) ||
        (p >= w && seen[p - w]) ||
        (p < w * (h - 1) && seen[p + w])
      if (!touches) continue
      const f = far(p)
      if (f < TOLERANCE * 2) d[p * 4 + 3] = Math.max(0, Math.round((255 * (f - TOLERANCE)) / TOLERANCE))
    }
  }

  // Trim to what's drawn.
  let top = h
  let bottom = -1
  let left = w
  let right = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] <= EMPTY) continue
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  if (bottom < 0) return file
  const trimmed = top > 0 || left > 0 || bottom < h - 1 || right < w - 1
  if (!removed && !trimmed) return file
  ctx.putImageData(image, 0, 0)
  const out = document.createElement('canvas')
  out.width = right - left + 1
  out.height = bottom - top + 1
  out.getContext('2d')?.drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height)
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) return file
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'pose'}.png`, { type: 'image/png' })
}
