'use client'

import type { AppSettings } from '@cutroom/shared/types'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { api, errorText } from './api'
import type {
  CommentInsightsDTO,
  IdeaDTO,
  LibraryBackgroundDTO,
  LibraryCharacterDTO,
  PerformanceDTO,
  ProjectDTO,
  ProjectFull,
  ProjectSummary,
  SceneDTO,
  SeriesDTO,
  StatusDTO,
} from './dto'

export const keys = {
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  status: ['status'] as const,
  settings: ['settings'] as const,
  schedule: ['schedule'] as const,
  series: ['series'] as const,
  library: ['library'] as const,
  backgrounds: ['backgrounds'] as const,
  ideas: ['ideas'] as const,
  performance: ['performance'] as const,
  comments: ['comments'] as const,
  voices: ['voices'] as const,
  playlists: (channelId: string | null) => ['playlists', channelId ?? 'default'] as const,
  channelSetup: (channelId: string | null) => ['channel-setup', channelId ?? 'default'] as const,
  channel: (channelId: string | null) => ['channel', channelId ?? 'default'] as const,
}

export function useSeriesList() {
  return useQuery({ queryKey: keys.series, queryFn: () => api.get<SeriesDTO[]>('/api/series') })
}

export function useLibrary() {
  return useQuery({
    queryKey: keys.library,
    queryFn: () => api.get<LibraryCharacterDTO[]>('/api/library/characters'),
  })
}

export function useBackgrounds() {
  return useQuery({
    queryKey: keys.backgrounds,
    queryFn: () => api.get<LibraryBackgroundDTO[]>('/api/library/backgrounds'),
  })
}

export function useIdeas() {
  return useQuery({ queryKey: keys.ideas, queryFn: () => api.get<IdeaDTO[]>('/api/ideas') })
}

export function useCommentInsights() {
  return useQuery({
    queryKey: keys.comments,
    queryFn: () => api.get<CommentInsightsDTO[]>('/api/performance/comments'),
  })
}

export function usePerformance() {
  return useQuery({ queryKey: keys.performance, queryFn: () => api.get<PerformanceDTO>('/api/performance') })
}

export interface VoiceOption {
  id: string
  name: string
  description: string
}

export function useVoices(enabled = true) {
  return useQuery({
    queryKey: keys.voices,
    queryFn: () =>
      api.get<{ gemini: VoiceOption[]; elevenlabs: VoiceOption[]; elevenlabsError: string | null }>(
        '/api/voices',
      ),
    staleTime: 10 * 60_000,
    enabled,
  })
}

/** A channel's playlists (the default channel when `channelId` is null). */
export function usePlaylists(channelId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.playlists(channelId),
    queryFn: () =>
      api.get<{ playlists: { id: string; title: string }[] }>(
        `/api/google/youtube${channelId ? `?channel=${encodeURIComponent(channelId)}` : ''}`,
      ),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: () => api.get<StatusDTO>('/api/status'),
    staleTime: 30_000,
  })
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<AppSettings>('/api/settings') })
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => api.get<ProjectSummary[]>('/api/projects'),
    refetchInterval: (query) =>
      query.state.data?.some((p) => p.job && ['queued', 'running'].includes(p.job.status)) ? 4000 : 30_000,
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: keys.project(id),
    queryFn: () => api.get<ProjectFull>(`/api/projects/${id}`),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs
      const statuses = [jobs?.retime?.status, jobs?.publish?.status, jobs?.voice?.status]
      if (statuses.some((s) => s === 'queued' || s === 'running')) return 3000
      if (statuses.includes('waiting')) return 15_000
      return false
    },
  })
}

// ---------------------------------------------------------------------------
// Autosave: edits apply to the cache immediately and reach the server after a short pause.

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

class Saver {
  state: SaveState = 'idle'
  private listeners = new Set<() => void>()
  private pendingProject: Partial<ProjectDTO> = {}
  private projectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingScenes = new Map<string, Partial<SceneDTO>>()
  private sceneTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private inflight = 0

  constructor(
    private id: string,
    private client: QueryClient,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(state: SaveState) {
    this.state = state
    for (const l of this.listeners) l()
  }

  private hasPending() {
    return Object.keys(this.pendingProject).length > 0 || this.pendingScenes.size > 0 || this.inflight > 0
  }

  project(patch: Partial<ProjectDTO>, delay = 700) {
    this.client.setQueryData<ProjectFull>(keys.project(this.id), (prev) =>
      prev ? { ...prev, project: { ...prev.project, ...patch } } : prev,
    )
    Object.assign(this.pendingProject, patch)
    if (this.projectTimer) clearTimeout(this.projectTimer)
    this.set('saving')
    return new Promise<void>((resolve) => {
      this.projectTimer = setTimeout(() => {
        void this.flushProject().then(resolve)
      }, delay)
    })
  }

  private async flushProject() {
    const patch = this.pendingProject
    this.pendingProject = {}
    this.projectTimer = null
    if (Object.keys(patch).length === 0) return
    this.inflight++
    try {
      const full = await api.patch<ProjectFull>(`/api/projects/${this.id}`, patch)
      this.inflight--
      if (!this.hasPending()) this.client.setQueryData(keys.project(this.id), full)
      this.done()
    } catch (error) {
      this.inflight--
      this.set('error')
      toast.error(errorText(error))
    }
  }

  scene(sceneId: string, patch: Partial<SceneDTO>, delay = 700) {
    this.client.setQueryData<ProjectFull>(keys.project(this.id), (prev) =>
      prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) } : prev,
    )
    this.pendingScenes.set(sceneId, { ...(this.pendingScenes.get(sceneId) ?? {}), ...patch })
    const existing = this.sceneTimers.get(sceneId)
    if (existing) clearTimeout(existing)
    this.set('saving')
    return new Promise<void>((resolve) => {
      this.sceneTimers.set(
        sceneId,
        setTimeout(() => {
          void this.flushScene(sceneId).then(resolve)
        }, delay),
      )
    })
  }

  private async flushScene(sceneId: string) {
    const patch = this.pendingScenes.get(sceneId)
    this.pendingScenes.delete(sceneId)
    this.sceneTimers.delete(sceneId)
    if (!patch) return
    this.inflight++
    try {
      await api.patch<SceneDTO>(`/api/scenes/${sceneId}`, patch)
      this.inflight--
      this.done()
    } catch (error) {
      this.inflight--
      this.set('error')
      toast.error(errorText(error))
      void this.client.invalidateQueries({ queryKey: keys.project(this.id) })
    }
  }

  async flushAll() {
    if (this.projectTimer) {
      clearTimeout(this.projectTimer)
      await this.flushProject()
    }
    for (const [sceneId, timer] of this.sceneTimers) {
      clearTimeout(timer)
      await this.flushScene(sceneId)
    }
  }

  private done() {
    if (!this.hasPending()) {
      this.set('saved')
      void this.client.invalidateQueries({ queryKey: keys.projects })
    }
  }
}

const savers = new Map<string, Saver>()

export function useSaver(id: string) {
  const client = useQueryClient()
  const saver = useMemo(() => {
    let existing = savers.get(id)
    if (!existing) {
      existing = new Saver(id, client)
      savers.set(id, existing)
    }
    return existing
  }, [id, client])
  const state = useSyncExternalStore(
    saver.subscribe,
    () => saver.state,
    () => 'idle' as SaveState,
  )
  return { saver, state }
}

/** Runs a server action that returns the full project, putting the result in the cache. */
export function useProjectAction(id: string) {
  const client = useQueryClient()
  const { saver } = useSaver(id)
  return useCallback(
    async (url: string, body: unknown = {}, success?: string) => {
      await saver.flushAll()
      try {
        const full = await api.post<ProjectFull>(url, body)
        client.setQueryData(keys.project(id), full)
        void client.invalidateQueries({ queryKey: keys.projects })
        if (success) toast.success(success)
        return full
      } catch (error) {
        toast.error(errorText(error))
        return null
      }
    },
    [client, id, saver],
  )
}

export function setProjectData(client: QueryClient, id: string, full: ProjectFull) {
  client.setQueryData(keys.project(id), full)
}
