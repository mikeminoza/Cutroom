'use client'

import { useQueryClient } from '@tanstack/react-query'
import { Check, Lightbulb, MessageCircleQuestion, MessagesSquare, Plus, ThumbsUp, Wrench } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import type { CommentInsightsDTO, IdeaDTO } from '@/lib/dto'
import { plural, timeAgo } from '@/lib/format'
import { keys, useCommentInsights, useIdeas, useStatus } from '@/lib/hooks'
import { Button, Panel } from './ui'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * What viewers say in the comments, per channel: Gemini reads the newest videos' comments and
 * sums up what viewers liked, asked for and want better. What they asked for becomes ideas.
 */
export function CommentInsightsPanels({ channels }: { channels: { id: string; title: string }[] }) {
  const { data: insights = [] } = useCommentInsights()
  return (
    <>
      {channels.map((channel) => (
        <ChannelComments
          key={channel.id}
          channel={channel}
          named={channels.length > 1}
          read={insights.find((i) => i.channelId === channel.id) ?? null}
        />
      ))}
    </>
  )
}

function ChannelComments({
  channel,
  named,
  read,
}: {
  channel: { id: string; title: string }
  named: boolean
  read: CommentInsightsDTO | null
}) {
  const client = useQueryClient()
  const { data: status } = useStatus()
  const { data: ideas = [] } = useIdeas()
  const [reading, setReading] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const canRead = status?.gemini.configured === true

  const readNow = async () => {
    setReading(true)
    try {
      const next = await api.post<CommentInsightsDTO>('/api/performance/comments', { channelId: channel.id })
      client.setQueryData<CommentInsightsDTO[]>(keys.comments, (prev) => [
        ...(prev ?? []).filter((i) => i.channelId !== channel.id),
        next,
      ])
      toast.success(next.comments ? `Read ${plural(next.comments, 'comment')}` : 'No comments yet')
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setReading(false)
    }
  }

  const inIdeas = (title: string) => ideas.some((idea) => same(idea.title, title))
  const addIdeas = async (requests: { title: string; angle: string }[]) => {
    const fresh = requests.filter((r) => !inIdeas(r.title))
    if (fresh.length === 0) return
    setAdding(fresh.length === 1 ? fresh[0].title : 'all')
    try {
      const added: IdeaDTO[] = []
      for (const request of fresh) {
        added.push(await api.post<IdeaDTO>('/api/ideas/own', { title: request.title, angle: request.angle }))
      }
      client.setQueryData<IdeaDTO[]>(keys.ideas, (prev) => [...added, ...(prev ?? [])])
      toast.success(`Added ${plural(added.length, 'idea')}`, { description: 'Find them on the Ideas page.' })
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setAdding(null)
    }
  }

  const found = read?.insights
  const requests = found?.requests ?? []
  return (
    <Panel
      title={named ? `What viewers say on ${channel.title}` : 'What viewers say'}
      description={
        read
          ? `From ${plural(read.comments, 'comment')} on the ${plural(read.videos, 'newest video')}, read ${timeAgo(read.updatedAt)}. Read again every week.`
          : canRead
            ? 'Gemini reads the comments on your newest videos and sums up what viewers liked, asked for and want better. Free, and read again every week.'
            : 'Add a Gemini key in Settings to have the comments on your videos summed up.'
      }
      actions={
        <Button
          variant={read ? 'plain' : 'go'}
          size="sm"
          busy={reading}
          disabled={!canRead}
          onClick={readNow}
          icon={<MessagesSquare className="size-3.5" />}
        >
          {read ? 'Read again' : 'Read comments'}
        </Button>
      }
    >
      {found && (
        <div className="flex flex-col gap-5 px-5 py-4">
          <p className="max-w-[80ch] text-[14.5px] leading-relaxed">{found.summary}</p>
          {read.comments > 0 && (
            <div className="grid gap-5 md:grid-cols-2">
              <Section icon={<ThumbsUp className="size-3.5" />} title="They liked" items={found.liked} />
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
                    <Lightbulb className="size-3.5" aria-hidden />
                    They asked for
                  </h3>
                  {requests.filter((r) => !inIdeas(r.title)).length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      busy={adding === 'all'}
                      disabled={adding !== null}
                      onClick={() => addIdeas(requests)}
                    >
                      Add all to Ideas
                    </Button>
                  )}
                </div>
                {requests.length === 0 ? (
                  <p className="text-[13px] text-ink-3">No requests yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {requests.map((request) => (
                      <li
                        key={request.title}
                        className="flex items-start gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-medium leading-snug">{request.title}</p>
                          {request.angle && (
                            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{request.angle}</p>
                          )}
                        </div>
                        {inIdeas(request.title) ? (
                          <span className="flex items-center gap-1 pt-0.5 text-[12.5px] text-ok">
                            <Check className="size-3.5" aria-hidden />
                            In Ideas
                          </span>
                        ) : (
                          <Button
                            variant="plain"
                            size="sm"
                            busy={adding === request.title}
                            disabled={adding !== null}
                            onClick={() => addIdeas([request])}
                            icon={<Plus className="size-3.5" />}
                          >
                            Idea
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Section icon={<Wrench className="size-3.5" />} title="Do better" items={found.improve} />
              <Section
                icon={<MessageCircleQuestion className="size-3.5" />}
                title="Questions to answer"
                items={found.questions}
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <span aria-hidden>{icon}</span>
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-3">Nothing stood out.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-snug text-ink-2 marker:text-ink-3">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
