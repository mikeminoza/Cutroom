'use client'

// Uploads go straight to storage: local disk in development, Vercel Blob in production.
import { upload as blobUpload } from '@vercel/blob/client'
import { ApiError } from './api'

export type UploadFolder = 'scenes' | 'characters' | 'voiceover' | 'music' | 'thumbnail'

export interface Uploaded {
  url: string
  key: string
}

function cleanName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(-80) || 'file'
  )
}

export async function uploadFile(
  file: File,
  projectId: string,
  folder: UploadFolder,
  driver: 'local' | 'blob',
  onProgress?: (fraction: number) => void,
): Promise<Uploaded> {
  const path = `projects/${projectId}/${folder}`
  if (driver === 'blob') {
    const blob = await blobUpload(`${path}/${cleanName(file.name)}`, file, {
      access: 'public',
      handleUploadUrl: '/api/upload/blob',
      multipart: file.size > 20 * 1024 * 1024,
      onUploadProgress: (event) => onProgress?.(event.percentage / 100),
    })
    return { url: blob.url, key: blob.pathname }
  }
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    form.append('folder', path)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText)
        } catch {
          return null
        }
      })()
      if (xhr.status >= 200 && xhr.status < 300 && data?.url) resolve(data)
      else reject(new ApiError(data?.error ?? 'Upload failed.', xhr.status))
    }
    xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection.', 0))
    xhr.send(form)
  })
}

export function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name} is not an image this browser can read.`))
    }
    img.src = url
  })
}

export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const value = audio.duration
      URL.revokeObjectURL(url)
      if (Number.isFinite(value) && value > 0) resolve(value)
      else reject(new Error('Could not read the length of this audio file.'))
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name} is not an audio file this browser can play.`))
    }
    audio.src = url
  })
}

export function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

export function isAudio(file: File): boolean {
  return file.type.startsWith('audio/')
}

/** "scene-03.png", "03.jpg", "Scene 3 final.webp" -> 3. Null when no number. */
export function sceneNumberFromName(name: string): number | null {
  const match = name.match(/(?:scene|shot|img|image|frame)?[\s_-]*0*(\d{1,4})(?!.*\d)/i)
  return match ? Number(match[1]) : null
}
