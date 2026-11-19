'use client'

// Puts the pictures the "Cutroom for Flow" extension makes in Google Flow onto their scenes, on
// whichever Cutroom page is open: uploaded like a dropped file, then saved on the scene.
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import type { ProjectFull, SceneDTO, StatusDTO } from '@/lib/dto'
import { fileFromDataUrl, listenToFlowExtension } from '@/lib/flow-extension'
import { plural } from '@/lib/format'
import { keys } from '@/lib/hooks'
import { imageSize, isImage, uploadFile } from '@/lib/upload'

export function FlowBridge() {
  const client = useQueryClient()
  useEffect(() => {
    let placed = 0
    return listenToFlowExtension(async (picture) => {
      try {
        const file = await fileFromDataUrl(picture.dataUrl, picture.name)
        if (!isImage(file)) throw new Error('Flow sent something that isn’t a picture.')
        const size = await imageSize(file)
        const status = await client.fetchQuery({
          queryKey: keys.status,
          queryFn: () => api.get<StatusDTO>('/api/status'),
          staleTime: 60_000,
        })
        const stored = await uploadFile(file, picture.projectId, 'scenes', status.storage)
        const scene = await api.patch<SceneDTO>(`/api/scenes/${picture.sceneId}`, {
          imageUrl: stored.url,
          imageWidth: size.width,
          imageHeight: size.height,
        })
        client.setQueryData<ProjectFull>(keys.project(picture.projectId), (prev) =>
          prev
            ? { ...prev, scenes: prev.scenes.map((s) => (s.id === scene.id ? { ...s, ...scene } : s)) }
            : prev,
        )
        void client.invalidateQueries({ queryKey: keys.projects })
        placed++
        toast.success(`${plural(placed, 'picture')} from Flow placed`, {
          id: 'flow-pictures',
          description: `Latest: scene ${picture.number}`,
        })
      } catch (error) {
        toast.error(`Scene ${picture.number} from Flow: ${errorText(error)}`)
        throw error
      }
    })
  }, [client])
  return null
}
