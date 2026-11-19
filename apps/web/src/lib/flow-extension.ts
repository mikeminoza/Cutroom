'use client'

// Talks to the "Cutroom for Flow" Chrome extension (apps/flow-extension) through window messages.
// Its script in this page (cutroom.js) says it's there, takes a project's scenes to make in Google
// Flow (Images step → "Make in Flow"), and hands back each picture to put on its scene.
// This page's messages are { source: 'cutroom' }; the extension's are { source: 'cutroom-flow' }.
import { useSyncExternalStore } from 'react'
import { errorText } from './api'
import type { ProjectFull } from './dto'
import { scenePrompts, scenePromptsText } from './scene-prompts'

const FROM_EXTENSION = 'cutroom-flow'
const TO_EXTENSION = 'cutroom'
/** The extension keeps a character's pictures under this size. */
const MAX_CHARACTER_PICTURE = 6 * 1024 * 1024

/** A picture made in Flow, for one scene. */
export interface FlowPicture {
  projectId: string
  sceneId: string
  number: number
  name: string
  dataUrl: string
}

/** What "Make in Flow" sends: every scene, and the characters' pictures to go with them. */
export interface FlowProject {
  projectId: string
  title: string
  /** The storyboard as "Copy all" gives it, shown in the extension. */
  text: string
  scenes: {
    id: string
    number: number
    range: { start: number; end: number; label: string }
    narration: string
    cast: string[]
    prompt: string
    hasImage: boolean
  }[]
  characters: {
    name: string
    description: string
    images: { name: string; type: string; dataUrl: string }[]
  }[]
}

export interface FlowSent {
  ok: boolean
  error?: string
  /** The extension's side panel opened by itself (Chrome doesn't always allow it). */
  panel?: boolean
}

const extension = { version: null as string | null, listeners: new Set<() => void>() }
const sends = new Map<string, (answer: FlowSent) => void>()
let onPicture: ((picture: FlowPicture) => Promise<void>) | null = null
let listening = false
let next = 0

function post(message: Record<string, unknown>) {
  window.postMessage({ source: TO_EXTENSION, ...message }, window.location.origin)
}

function isPicture(data: Record<string, unknown>): boolean {
  return (
    typeof data.projectId === 'string' &&
    typeof data.sceneId === 'string' &&
    typeof data.dataUrl === 'string' &&
    data.dataUrl.startsWith('data:image/')
  )
}

async function takePicture(data: Record<string, unknown>) {
  const requestId = data.requestId
  // Not answering lets the extension try another Cutroom tab, or save to Downloads.
  if (!onPicture || typeof requestId !== 'string' || !isPicture(data)) return
  post({ type: 'picture-received', requestId })
  try {
    await onPicture({
      projectId: data.projectId as string,
      sceneId: data.sceneId as string,
      number: Number(data.number) || 0,
      name: typeof data.name === 'string' && data.name ? data.name : 'flow.png',
      dataUrl: data.dataUrl as string,
    })
    post({ type: 'picture-saved', requestId, ok: true })
  } catch (error) {
    post({ type: 'picture-saved', requestId, ok: false, error: errorText(error) })
  }
}

function onMessage(event: MessageEvent) {
  if (event.source !== window || event.origin !== window.location.origin) return
  const data = event.data as Record<string, unknown> | null
  if (!data || data.source !== FROM_EXTENSION) return
  if (data.type === 'ready') {
    extension.version = typeof data.version === 'string' ? data.version : '?'
    for (const listener of extension.listeners) listener()
  } else if (data.type === 'sent' && typeof data.requestId === 'string') {
    sends.get(data.requestId)?.({
      ok: Boolean(data.ok),
      error: typeof data.error === 'string' ? data.error : undefined,
      panel: Boolean(data.panel),
    })
  } else if (data.type === 'picture') {
    void takePicture(data)
  }
}

/**
 * Listens to the extension (once per page), asks whether it's there, and has `handler` store the
 * pictures it hands back. Returns a function that stops taking pictures.
 */
export function listenToFlowExtension(handler: (picture: FlowPicture) => Promise<void>): () => void {
  onPicture = handler
  if (!listening) {
    window.addEventListener('message', onMessage)
    listening = true
  }
  post({ type: 'hello' })
  return () => {
    if (onPicture === handler) onPicture = null
  }
}

/** The extension's version once it has said it's in this page, or null. */
export function useFlowExtension(): string | null {
  return useSyncExternalStore(
    (listener) => {
      extension.listeners.add(listener)
      return () => {
        extension.listeners.delete(listener)
      }
    },
    () => extension.version,
    () => null,
  )
}

/** Hands the project to the extension, which opens Flow and its side panel. */
export function sendToFlow(project: FlowProject): Promise<FlowSent> {
  const requestId = `send-${Date.now()}-${++next}`
  return new Promise((resolve) => {
    const finish = (answer: FlowSent) => {
      clearTimeout(timer)
      sends.delete(requestId)
      resolve(answer)
    }
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: 'The Cutroom for Flow extension didn’t answer. Reload this page and try again.',
        }),
      15_000,
    )
    sends.set(requestId, finish)
    post({ type: 'send', requestId, payload: project })
  })
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** A stored picture as a data URL the extension can keep, or null when it can't be read. */
async function pictureData(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/') || blob.size > MAX_CHARACTER_PICTURE) return null
    const name = decodeURIComponent(new URL(url, window.location.href).pathname.split('/').pop() || '')
    return { name: name || 'character.png', type: blob.type, dataUrl: await readAsDataUrl(blob) }
  } catch {
    return null
  }
}

/** The project as the extension takes it: every scene's prompt, and its characters' pictures. */
export async function flowProject(data: ProjectFull): Promise<FlowProject> {
  const entries = scenePrompts(data)
  const characters = await Promise.all(
    data.characters
      .filter((character) => character.images.length > 0)
      .map(async (character) => ({
        name: character.name,
        description: character.description,
        images: (
          await Promise.all(character.images.slice(0, 3).map((image) => pictureData(image.url)))
        ).filter((image) => image !== null),
      })),
  )
  return {
    projectId: data.project.id,
    title: data.project.title,
    text: scenePromptsText(entries),
    scenes: entries.map((entry) => ({
      id: entry.id,
      number: entry.number,
      range: { start: entry.start, end: entry.end, label: entry.range },
      narration: entry.narration,
      cast: entry.cast,
      prompt: entry.prompt,
      hasImage: entry.hasImage,
    })),
    characters: characters.filter((character) => character.images.length > 0),
  }
}

/** A data URL as a file to upload. */
export async function fileFromDataUrl(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], name, { type: blob.type })
}
