'use client'

import { LAYER_SIDES, type LayerSide } from '@cutroom/shared/types'
import { Check, FlipHorizontal2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, Field, Segmented, Select, Switch, Textarea } from '@/components/ui'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { ProjectFull } from '@/lib/dto'
import { useBackgrounds, useLibrary, useSaver } from '@/lib/hooks'
import { loadImage } from '@/lib/picture'
import { useUploader } from './fields'

const W = 1280
const H = 720
const FILLS = ['#FFD000', '#FFFFFF', '#FF3B30', '#3DDC97', '#4FC3F7']
const OUTLINES = ['#000000', '#FFFFFF', '#1B202B']

type Place = 'top' | 'middle' | 'bottom'

interface Design {
  /** A picture URL, or null for the plain colour. */
  background: string | null
  color: string
  pose: string | null
  side: LayerSide
  /** Pose height as a share of the thumbnail's height. */
  poseSize: number
  flip: boolean
  text: string
  textSize: number
  fill: string
  outline: string
  place: Place
  upper: boolean
}

const named = (name: string) => name.trim().toLowerCase()

/** Words into lines no wider than `width`; a word too long for a line gets a line of its own. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > width) {
        lines.push(line)
        line = word
      } else line = next
    }
    if (line) lines.push(line)
  }
  return lines
}

/** Paints the design; `current` says, once the pictures are loaded, whether it's still wanted. */
async function draw(canvas: HTMLCanvasElement, design: Design, font: string, current = () => true) {
  const ctx = canvas.getContext('2d')!
  const [background, pose] = await Promise.all([
    design.background ? loadImage(design.background).catch(() => null) : null,
    design.pose ? loadImage(design.pose).catch(() => null) : null,
  ])
  if (!current()) return
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = design.color
  ctx.fillRect(0, 0, W, H)
  if (background) {
    const scale = Math.max(W / background.naturalWidth, H / background.naturalHeight)
    const w = background.naturalWidth * scale
    const h = background.naturalHeight * scale
    ctx.drawImage(background, (W - w) / 2, (H - h) / 2, w, h)
  }
  // Darker edges make the character and the text pop.
  const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.45)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)

  const margin = 40
  let textLeft = margin * 1.5
  let textRight = W - margin * 1.5
  if (pose) {
    const h = H * design.poseSize
    const w = (pose.naturalWidth / pose.naturalHeight) * h
    const x = design.side === 'left' ? margin : design.side === 'right' ? W - w - margin : (W - w) / 2
    const y = H - h + h * 0.02
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 36
    if (design.flip) {
      ctx.translate(x + w, y)
      ctx.scale(-1, 1)
      ctx.drawImage(pose, 0, 0, w, h)
    } else ctx.drawImage(pose, x, y, w, h)
    ctx.restore()
    // The text takes the other side of the picture.
    if (design.side === 'left') textLeft = Math.min(x + w * 0.85, W * 0.5)
    if (design.side === 'right') textRight = Math.max(x + w * 0.15, W * 0.5)
  }

  const text = (design.upper ? design.text.toUpperCase() : design.text).trim()
  if (text) {
    const width = textRight - textLeft
    let size = design.textSize
    let lines: string[] = []
    // Shrink until every line fits and the block fits the height.
    for (; size >= 36; size -= 4) {
      ctx.font = `900 ${size}px ${font}`
      lines = wrap(ctx, text, width)
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width))
      if (widest <= width && lines.length * size * 1.05 <= H - margin * 2) break
    }
    const lineHeight = size * 1.02
    const block = lineHeight * lines.length
    const top =
      design.place === 'top'
        ? margin * 1.5
        : design.place === 'bottom'
          ? H - margin * 1.5 - block
          : (H - block) / 2
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.lineJoin = 'round'
    const cx = (textLeft + textRight) / 2
    lines.forEach((line, i) => {
      const y = top + i * lineHeight
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 24
      ctx.shadowOffsetY = 6
      ctx.lineWidth = size * 0.17
      ctx.strokeStyle = design.outline
      ctx.strokeText(line, cx, y)
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = design.fill
      ctx.fillText(line, cx, y)
    })
  }
  ctx.restore()
}

/**
 * Makes a thumbnail in the browser, for free: a background (from the Library or a scene), a
 * character pose and big outlined text. Saved as a 1280×720 JPEG, the size YouTube wants.
 */
export function ThumbnailMaker({
  data,
  open,
  onOpenChange,
}: {
  data: ProjectFull
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { project, scenes, characters } = data
  const { saver } = useSaver(project.id)
  const upload = useUploader(project.id)
  const { data: backgrounds = [], isFetched: backgroundsLoaded } = useBackgrounds()
  const { data: library = [], isFetched: libraryLoaded } = useLibrary()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [saving, setSaving] = useState(false)

  // Pictures to start from: the Library's backgrounds first, then this video's own scenes.
  const pictures = useMemo(() => {
    const urls = [
      ...backgrounds.map((b) => ({ url: b.url, name: b.name || 'Background' })),
      ...scenes.flatMap((s) => {
        const url = s.imageUrl ?? s.layer?.backgroundUrl
        return url ? [{ url, name: `Scene ${s.index + 1}` }] : []
      }),
    ]
    return urls.filter((p, i) => urls.findIndex((q) => q.url === p.url) === i).slice(0, 24)
  }, [backgrounds, scenes])
  const cast = useMemo(() => {
    const inProject = new Set(characters.map((c) => named(c.name)))
    return library
      .filter((c) => c.poses.length > 0)
      .sort((a, b) => Number(inProject.has(named(b.name))) - Number(inProject.has(named(a.name))))
  }, [library, characters])

  const [design, setDesign] = useState<Design | null>(null)
  // Start from the first picture and the main character's first pose, once they're known.
  useEffect(() => {
    if (!open || design || !backgroundsLoaded || !libraryLoaded) return
    setDesign({
      background: pictures[0]?.url ?? null,
      color: '#1B6FD8',
      pose: cast[0]?.poses[0]?.url ?? null,
      side: 'left',
      poseSize: 0.9,
      flip: false,
      text: project.title,
      textSize: 150,
      fill: FILLS[0],
      outline: OUTLINES[0],
      place: 'middle',
      upper: true,
    })
  }, [open, design, backgroundsLoaded, libraryLoaded, pictures, cast, project.title])

  const set = (patch: Partial<Design>) => setDesign((d) => (d ? { ...d, ...patch } : d))
  const [font, setFont] = useState('sans-serif')
  useEffect(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-archivo').trim()
    const value = family
      ? `${family}, "Arial Black", Impact, sans-serif`
      : '"Arial Black", Impact, sans-serif'
    void document.fonts.load(`900 100px ${value}`).finally(() => setFont(value))
  }, [])

  useEffect(() => {
    if (!design || !canvas.current) return
    const target = canvas.current
    let stale = false
    // Drawing waits for pictures to load: only the latest design gets painted.
    const timer = setTimeout(() => void draw(target, design, font, () => !stale), 30)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [design, font])

  const save = async () => {
    if (!design || !canvas.current) return
    setSaving(true)
    try {
      await draw(canvas.current, design, font)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.current!.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('The thumbnail could not be saved.'))),
          'image/jpeg',
          0.9,
        ),
      )
      const stored = await upload(new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }), 'thumbnail')
      await saver.project({ thumbnailUrl: stored.url }, 0)
      toast.success('Thumbnail ready')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Make a thumbnail"
      description="A background, a character pose and big text, made right here for free."
      width="max-w-5xl"
      footer={
        <>
          <Button variant="plain" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="go"
            busy={saving}
            disabled={!design}
            onClick={save}
            icon={<Check className="size-4" />}
          >
            Use as thumbnail
          </Button>
        </>
      }
    >
      {design && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex flex-col gap-3">
            <canvas
              ref={canvas}
              width={W}
              height={H}
              className="aspect-video w-full rounded-[var(--radius-control)] bg-film"
              aria-label="Thumbnail preview"
            />
            <Field label="Text" hint="Three or four big words work best.">
              <Textarea
                value={design.text}
                maxLength={80}
                rows={2}
                onChange={(e) => set({ text: e.target.value })}
                className="min-h-0"
              />
            </Field>
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Background">
              <div className="grid grid-cols-4 gap-1.5">
                {pictures.map((p) => (
                  <button
                    key={p.url}
                    type="button"
                    title={p.name}
                    aria-label={p.name}
                    aria-pressed={design.background === p.url}
                    onClick={() => set({ background: p.url })}
                    className={cn(
                      'aspect-video overflow-hidden rounded-[4px] ring-offset-1 ring-offset-panel',
                      design.background === p.url ? 'ring-2 ring-ink' : 'ring-1 ring-line hover:ring-ink-3',
                    )}
                  >
                    {/* biome-ignore lint/performance/noImgElement: user uploads */}
                    <img src={p.url} alt="" className="size-full object-cover" />
                  </button>
                ))}
                <label
                  className={cn(
                    'relative aspect-video cursor-pointer overflow-hidden rounded-[4px] ring-offset-1 ring-offset-panel',
                    design.background === null ? 'ring-2 ring-ink' : 'ring-1 ring-line hover:ring-ink-3',
                  )}
                  style={{ background: design.color }}
                  title="Plain colour"
                >
                  <input
                    type="color"
                    value={design.color}
                    onChange={(e) => set({ color: e.target.value, background: null })}
                    onClick={() => set({ background: null })}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                    aria-label="Plain colour"
                  />
                </label>
              </div>
            </Field>

            <Field label="Character">
              <div className="flex flex-col gap-2">
                <Select
                  aria-label="Character pose"
                  value={design.pose ?? ''}
                  onChange={(e) => set({ pose: e.target.value || null })}
                >
                  <option value="">No character</option>
                  {cast.map((c) => (
                    <optgroup key={c.id} label={c.name || 'Character'}>
                      {c.poses.map((p) => (
                        <option key={p.id} value={p.url}>
                          {p.name || 'Pose'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                {design.pose && (
                  <>
                    <div className="flex items-center gap-2">
                      <Segmented<LayerSide>
                        ariaLabel="Where the character stands"
                        value={design.side}
                        onChange={(side) => set({ side })}
                        options={LAYER_SIDES.map((side) => ({
                          value: side,
                          label: side === 'center' ? 'Middle' : side === 'left' ? 'Left' : 'Right',
                        }))}
                      />
                      <Button
                        variant={design.flip ? 'dark' : 'plain'}
                        size="sm"
                        aria-pressed={design.flip}
                        onClick={() => set({ flip: !design.flip })}
                        icon={<FlipHorizontal2 className="size-3.5" />}
                      >
                        Flip
                      </Button>
                    </div>
                    <label className="flex items-center gap-3 text-[13px] text-ink-2">
                      Size
                      <input
                        type="range"
                        min={0.4}
                        max={1.2}
                        step={0.02}
                        value={design.poseSize}
                        onChange={(e) => set({ poseSize: Number(e.target.value) })}
                        className="flex-1 accent-ink"
                      />
                    </label>
                  </>
                )}
                {cast.length === 0 && (
                  <p className="text-[12.5px] text-ink-3">
                    Add poses to a character in the Library to use them here.
                  </p>
                )}
              </div>
            </Field>

            <Field label="Text style">
              <div className="flex flex-col gap-2.5">
                <Swatches
                  label="Text colour"
                  colors={FILLS}
                  value={design.fill}
                  onChange={(fill) => set({ fill })}
                />
                <Swatches
                  label="Outline colour"
                  colors={OUTLINES}
                  value={design.outline}
                  onChange={(outline) => set({ outline })}
                />
                <Segmented<Place>
                  ariaLabel="Text position"
                  value={design.place}
                  onChange={(place) => set({ place })}
                  options={[
                    { value: 'top', label: 'Top' },
                    { value: 'middle', label: 'Middle' },
                    { value: 'bottom', label: 'Bottom' },
                  ]}
                />
                <label className="flex items-center gap-3 text-[13px] text-ink-2">
                  Size
                  <input
                    type="range"
                    min={60}
                    max={220}
                    step={4}
                    value={design.textSize}
                    onChange={(e) => set({ textSize: Number(e.target.value) })}
                    className="flex-1 accent-ink"
                  />
                </label>
                <Switch
                  checked={design.upper}
                  onCheckedChange={(upper) => set({ upper })}
                  label="Capital letters"
                />
              </div>
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string
  colors: string[]
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn(
            'size-7 rounded-full ring-offset-2 ring-offset-panel',
            value === color ? 'ring-2 ring-ink' : 'ring-1 ring-line-strong',
          )}
          style={{ background: color }}
        />
      ))}
      <span className="ml-1 text-[12.5px] text-ink-3">{label}</span>
    </div>
  )
}
