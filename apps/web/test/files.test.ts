import { describe, expect, it } from 'vitest'
import { downloadHref } from '../src/lib/upload'

describe('download links', () => {
  it('asks Vercel Blob for an attachment, and leaves local files alone', () => {
    expect(downloadHref('https://abc.public.blob.vercel-storage.com/projects/p/renders/video.mp4')).toBe(
      'https://abc.public.blob.vercel-storage.com/projects/p/renders/video.mp4?download=1',
    )
    expect(downloadHref('/api/files/projects/p/renders/video.mp4')).toBe(
      '/api/files/projects/p/renders/video.mp4',
    )
    // Not a Blob address, even though it mentions one.
    expect(downloadHref('https://evil.example/x.blob.vercel-storage.com/v.mp4')).toBe(
      'https://evil.example/x.blob.vercel-storage.com/v.mp4',
    )
  })
})
