import {
  type ImageFit,
  type LayerSide,
  poseBox,
  type SceneLayer,
  type VideoFormat,
} from '@cutroom/shared/types'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/** Where the pose stands in the frame: the same box and side as the render (shared poseBox). */
export function poseStyle(side: LayerSide, format: VideoFormat): CSSProperties {
  const box = poseBox(format)
  const pct = (n: number) => `${n * 100}%`
  return {
    bottom: 0,
    height: pct(box.height),
    width: 'auto',
    maxWidth: pct(box.width),
    ...(side === 'left'
      ? { left: pct(box.margin) }
      : side === 'right'
        ? { right: pct(box.margin) }
        : { left: '50%' }),
    // `translate` leaves `transform` free for the breathing and talking animations.
    translate: `${side === 'center' ? '-50%' : '0'} ${pct(box.sink)}`,
  }
}

/**
 * A layered scene picture: the background, with the character's pose standing in front of it.
 * `alive` adds the gentle breathing of the video, `talking` its bounce while the narrator speaks.
 */
export function LayeredPicture({
  layer,
  fit,
  focusX = 0.5,
  focusY = 0.5,
  format,
  alive = false,
  talking = false,
  className,
}: {
  layer: SceneLayer
  fit: ImageFit
  focusX?: number
  focusY?: number
  format: VideoFormat
  alive?: boolean
  talking?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative overflow-hidden bg-film', className)}>
      {layer.backgroundUrl && fit === 'contain' && (
        // biome-ignore lint/performance/noImgElement: user uploads
        <img
          src={layer.backgroundUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-md"
        />
      )}
      {layer.backgroundUrl && (
        // biome-ignore lint/performance/noImgElement: user uploads
        <img
          src={layer.backgroundUrl}
          alt={layer.background}
          className={cn('absolute inset-0 size-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          style={fit === 'cover' ? { objectPosition: `${focusX * 100}% ${focusY * 100}%` } : undefined}
        />
      )}
      {layer.poseUrl && (
        // biome-ignore lint/performance/noImgElement: user uploads
        <img
          src={layer.poseUrl}
          alt={[layer.character, layer.pose].filter(Boolean).join(', ')}
          className={cn(
            'absolute object-contain object-bottom',
            alive && (talking ? 'animate-talk' : 'animate-breathe'),
          )}
          style={poseStyle(layer.side, format)}
        />
      )}
    </div>
  )
}
