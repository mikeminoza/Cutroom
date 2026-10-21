// Issues short-lived tokens so the browser can upload straight to Vercel Blob.
import { type HandleUploadBody, handleUpload } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { isAuthorized } from '@/server/auth'
import { toErrorResponse } from '@/server/http'

const FOLDER =
  /^(projects\/[\w-]+\/(scenes|characters|voiceover|music|thumbnail)|library\/characters\/[\w-]+)\//

export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as HandleUploadBody
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await isAuthorized(request))) throw new Error('Sign in to upload files.')
        if (!FOLDER.test(pathname)) throw new Error('Unknown upload folder.')
        return {
          allowedContentTypes: ['image/*', 'audio/*'],
          maximumSizeInBytes: 500 * 1024 * 1024,
          addRandomSuffix: true,
        }
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    return toErrorResponse(error)
  }
}
