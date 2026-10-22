'use client'

import type { CharacterPose } from '@cutroom/shared/types'
import { Check, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { eraseAt } from '@/lib/cutout'
import { loadImage } from '@/lib/picture'
import { Button, Dialog, Spinner } from './ui'

/** A light checkerboard behind cut-outs, so their transparent parts show. */
const CHECKER =
  'bg-sunk [background-image:conic-gradient(var(--color-line)_25%,transparent_0_50%,var(--color-line)_0_75%,transparent_0)] [background-size:14px_14px]'

/** Where a click landed, as fractions of the picture, so it can be replayed on the eyes-closed one. */
interface Spot {
  x: number
  y: number
}

async function canvasOf(url: string): Promise<HTMLCanvasElement> {
  const image = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  canvas.getContext('2d', { willReadFrequently: true })?.drawImage(image, 0, 0)
  return canvas
}

const pngOf = (canvas: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('Could not save.')),
      'image/png',
    ),
  )

/**
 * Clears leftover background inside a pose's outline (the gap between an arm and the body): click
 * a patch and it turns transparent. The same clicks go to the eyes-closed version, so blinking
 * never flashes the old background.
 */
export function PoseTouchUp({
  pose,
  onClose,
  onSave,
}: {
  pose: CharacterPose
  onClose: () => void
  onSave: (files: { pose: File; blink: File | null }) => Promise<void>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [history, setHistory] = useState<ImageData[]>([])
  const [spots, setSpots] = useState<Spot[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void canvasOf(pose.url)
      .then((source) => {
        const target = canvas.current
        if (cancelled || !target) return
        target.width = source.width
        target.height = source.height
        target.getContext('2d', { willReadFrequently: true })?.drawImage(source, 0, 0)
        setReady(true)
      })
      .catch((error) => toast.error(errorText(error)))
    return () => {
      cancelled = true
    }
  }, [pose.url])

  const click = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const target = canvas.current
    const ctx = target?.getContext('2d', { willReadFrequently: true })
    if (!target || !ctx || saving) return
    const rect = target.getBoundingClientRect()
    const spot = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
    const before = ctx.getImageData(0, 0, target.width, target.height)
    const after = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height)
    if (eraseAt(after, spot.x * target.width, spot.y * target.height) === 0) return
    ctx.putImageData(after, 0, 0)
    setHistory((h) => [...h.slice(-9), before])
    setSpots((s) => [...s, spot])
  }

  const undo = () => {
    const previous = history[history.length - 1]
    if (!previous) return
    canvas.current?.getContext('2d')?.putImageData(previous, 0, 0)
    setHistory((h) => h.slice(0, -1))
    setSpots((s) => s.slice(0, -1))
  }

  const save = async () => {
    const target = canvas.current
    if (!target) return
    setSaving(true)
    try {
      const name = (pose.name || 'pose').replace(/[^\w-]+/g, '-')
      let blink: File | null = null
      if (pose.blinkUrl) {
        // The eyes-closed picture is the same drawing: the same spots clear the same patches.
        const closed = await canvasOf(pose.blinkUrl)
        const ctx = closed.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          const image = ctx.getImageData(0, 0, closed.width, closed.height)
          for (const spot of spots) eraseAt(image, spot.x * closed.width, spot.y * closed.height)
          ctx.putImageData(image, 0, 0)
          blink = await pngOf(closed, `${name}-blink.png`)
        }
      }
      await onSave({ pose: await pngOf(target, `${name}.png`), blink })
      onClose()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Touch up ${pose.name || 'this pose'}`}
      description="Click any leftover background inside the outline (between an arm and the body, under the chin) and it turns transparent. Careful with the eyes: undo if one goes."
      width="max-w-2xl"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={undo}
            disabled={history.length === 0 || saving}
            icon={<Undo2 className="size-4" />}
          >
            Undo
          </Button>
          <Button variant="plain" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="go"
            busy={saving}
            disabled={spots.length === 0}
            onClick={save}
            icon={<Check className="size-4" />}
          >
            Save
          </Button>
        </>
      }
    >
      <div
        className={`relative grid min-h-48 place-items-center rounded-[var(--radius-control)] p-3 ${CHECKER}`}
      >
        {!ready && <Spinner className="absolute text-ink-3" />}
        <canvas
          ref={canvas}
          onClick={click}
          aria-label="Pose: click a patch of background to clear it"
          className="max-h-[60vh] max-w-full cursor-crosshair object-contain"
          style={{ visibility: ready ? 'visible' : 'hidden' }}
        />
      </div>
      {pose.blinkUrl && (
        <p className="mt-2 text-[12.5px] text-ink-3">The eyes-closed version gets the same touch-ups.</p>
      )}
    </Dialog>
  )
}
