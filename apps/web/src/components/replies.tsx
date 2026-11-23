'use client'

import { REPLIES } from '@cutroom/shared/replies'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, MessageSquareReply, RefreshCw, Send, Sparkles, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, errorText } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { RepliesDTO, ReplyChange, ReplyCommentDTO, ReplyVideoDTO, SentRepliesDTO } from '@/lib/dto'
import { plural, timeAgo } from '@/lib/format'
import { keys, useStatus } from '@/lib/hooks'
import { streamAnswer } from '@/lib/stream'
import { Button, Panel, Textarea } from './ui'

const commentUrl = (video: ReplyVideoDTO, id: string) =>
  `https://www.youtube.com/watch?v=${video.youtubeVideoId}&lc=${id}`

/**
 * Performance → Comments to answer, per channel: the comments on its videos out in the last
 * REPLIES.days that still wait for its reply. Gemini drafts a video's replies when you ask; you
 * edit and approve them, and Cutroom posts them in each comment's thread when you click. Nothing
 * goes out without that click. Grow the channel links here (#replies).
 */
export function ReplyPanels({ channels }: { channels: { id: string; title: string }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  // Rendered once the page's stats are in, after the browser looked for the anchor.
  useEffect(() => {
    if (window.location.hash === '#replies') ref.current?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <div id="replies" ref={ref} className="flex scroll-mt-6 flex-col gap-6">
      {channels.map((channel) => (
        <ChannelReplies key={channel.id} channel={channel} named={channels.length > 1} />
      ))}
    </div>
  )
}

function ChannelReplies({ channel, named }: { channel: { id: string; title: string }; named: boolean }) {
  const client = useQueryClient()
  const { data: status } = useStatus()
  const key = keys.replies(channel.id)
  const { data, error, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<RepliesDTO>(`/api/replies?channel=${encodeURIComponent(channel.id)}`),
  })
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [drafting, setDrafting] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  /** What you typed, by comment: shown, and posted, instead of the stored draft. */
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [approved, setApproved] = useState<Set<string>>(() => new Set())
  const [showDone, setShowDone] = useState<Set<string>>(() => new Set())
  const canDraft = status?.gemini.configured === true

  const check = useCallback(
    async (quiet: boolean) => {
      setChecking(true)
      setCheckError(null)
      try {
        const next = await api.post<RepliesDTO>('/api/replies', { channelId: channel.id })
        client.setQueryData(keys.replies(channel.id), next)
        if (!quiet) toast.success('Comments read from YouTube')
      } catch (err) {
        if (quiet) setCheckError(errorText(err))
        else toast.error(errorText(err))
      } finally {
        setChecking(false)
      }
    },
    [client, channel.id],
  )

  // Opening the page reads YouTube again once the last read is over an hour old: 1 quota unit a
  // video, and the list is fresh when you come from Grow the channel. Otherwise only on Check again.
  const autoChecked = useRef(false)
  useEffect(() => {
    if (!data || autoChecked.current) return
    autoChecked.current = true
    const age = data.checkedAt ? Date.now() - Date.parse(data.checkedAt) : Number.POSITIVE_INFINITY
    if (data.read > 0 && age > REPLIES.freshMinutes * 60_000) void check(true)
  }, [data, check])

  const textOf = (comment: ReplyCommentDTO) => texts[comment.id] ?? comment.draft ?? ''
  const patchCache = (id: string, change: Partial<ReplyCommentDTO>) =>
    client.setQueryData<RepliesDTO>(key, (prev) =>
      prev
        ? {
            ...prev,
            videos: prev.videos.map((v) => ({
              ...v,
              comments: v.comments.map((c) => (c.id === id ? { ...c, ...change } : c)),
            })),
          }
        : prev,
    )
  const approve = (ids: string[], on: boolean) =>
    setApproved((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  /** Each draft shows on its comment as soon as Gemini has written it; all are saved at the end. */
  const draft = async (video: ReplyVideoDTO) => {
    setDrafting(video.projectId)
    try {
      const next = await streamAnswer<RepliesDTO, { comments: ReplyChange[] }>(
        '/api/replies/draft',
        { projectId: video.projectId },
        {
          partial: ({ comments }) => {
            for (const { id, ...change } of comments) patchCache(id, change)
          },
        },
      )
      client.setQueryData(key, next)
      toast.success('Replies drafted', {
        description: 'Read each one, change what you like and approve it. Nothing is posted until you click.',
      })
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setDrafting(null)
    }
  }

  const url = (comment: ReplyCommentDTO) => `/api/replies/${encodeURIComponent(comment.id)}`
  /** Edits on their way to the server, by comment. */
  const saving = useRef(new Map<string, Promise<void>>())

  /** Keeps your edit, so a reload or another visit shows it. */
  const save = (comment: ReplyCommentDTO) => {
    const text = texts[comment.id]
    if (text === undefined || text === (comment.draft ?? '')) return
    const run = (async () => {
      try {
        patchCache(comment.id, await api.patch<ReplyCommentDTO>(url(comment), { draft: text }))
      } catch (err) {
        toast.error(errorText(err))
      }
    })()
    saving.current.set(comment.id, run)
  }

  const setStatus = async (comment: ReplyCommentDTO, next: 'waiting' | 'skipped') => {
    try {
      patchCache(comment.id, await api.patch<ReplyCommentDTO>(url(comment), { status: next }))
      if (next === 'skipped') approve([comment.id], false)
    } catch (err) {
      toast.error(errorText(err))
    }
  }

  /** Posts exactly these texts, each as a reply in its comment's thread. */
  const post = async (items: { comment: ReplyCommentDTO; text: string }[], busy: string) => {
    setSending(busy)
    try {
      // Leaving the text box to click Post saves the edit: let that land first.
      await Promise.all(items.map(({ comment }) => saving.current.get(comment.id)))
      const result = await api.post<SentRepliesDTO>('/api/replies/send', {
        replies: items.map(({ comment, text }) => ({ id: comment.id, text })),
      })
      for (const reply of result.sent) {
        patchCache(reply.id, { status: 'replied', draft: reply.text, replyId: reply.replyId })
      }
      approve(
        result.sent.map((reply) => reply.id),
        false,
      )
      // What went out stays in view, under its comment.
      const posted = new Set(result.sent.map((reply) => reply.id))
      const shown = (data?.videos ?? []).filter((v) => v.comments.some((c) => posted.has(c.id)))
      setShowDone((prev) => new Set([...prev, ...shown.map((v) => v.projectId)]))
      const notes = result.notes.join(' ')
      if (result.sent.length) {
        toast.success(`Posted ${plural(result.sent.length, 'reply', 'replies')}`, {
          description: notes || undefined,
          duration: notes ? 10_000 : undefined,
        })
      } else {
        toast.error(notes || 'Nothing was posted: those comments have your reply already.')
      }
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setSending(null)
    }
  }

  const videos = data?.videos ?? []
  const waiting = videos.flatMap((v) => v.comments.filter((c) => c.status === 'waiting'))
  const ready = waiting.filter((c) => approved.has(c.id) && textOf(c).trim())

  return (
    <Panel
      title={named ? `Comments to answer on ${channel.title}` : 'Comments to answer'}
      description={
        !data || data.read === 0
          ? `Comments on your public videos out in the last ${REPLIES.days} days show up here, ready to answer.`
          : `Answer while a video is new: replies bring more comments. From your ${plural(data.read, 'video')} out in the last ${REPLIES.days} days${data.checkedAt ? `, read ${timeAgo(data.checkedAt)}` : ''}. Gemini drafts replies in your narrator's voice when you ask; nothing is posted until you click.`
      }
      actions={
        data && data.read > 0 ? (
          <Button
            variant="plain"
            size="sm"
            busy={checking}
            onClick={() => check(false)}
            icon={<RefreshCw className="size-3.5" />}
          >
            Check again
          </Button>
        ) : undefined
      }
    >
      {error && (
        <p className="px-5 py-4 text-[13.5px] text-bad">Could not load comments: {errorText(error)}</p>
      )}
      {checkError && (
        <p className="border-b border-line px-5 py-3 text-[13.5px] text-bad">
          Could not read the comments: {checkError}
        </p>
      )}
      {isLoading && (
        <div className="m-5 h-24 animate-pulse-soft rounded-[var(--radius-control)] bg-line/50" />
      )}
      {status && !canDraft && waiting.some((c) => c.draft === null) && (
        <p className="border-b border-line px-5 py-3 text-[13px] text-ink-2">
          Add GEMINI_API_KEY to have Gemini draft replies. You can still write them yourself.
        </p>
      )}
      {data && data.read > 0 && waiting.length === 0 && (
        <p className="px-5 py-4 text-[13.5px] text-ink-2">
          {checking && !data.checkedAt
            ? 'Reading the comments…'
            : data.checkedAt
              ? 'No comments waiting for your reply.'
              : 'Not read yet: Check again reads them from YouTube.'}
        </p>
      )}

      {videos.length > 0 && (
        <ul className="divide-y divide-line">
          {videos.map((video) => {
            const open = video.comments.filter((c) => c.status === 'waiting')
            const done = video.comments.filter((c) => c.status !== 'waiting')
            const answered = done.filter((c) => c.status === 'replied').length
            const skipped = done.length - answered
            const undrafted = open.filter((c) => c.draft === null).length
            const unapproved = open.filter((c) => !approved.has(c.id) && textOf(c).trim())
            const showing = showDone.has(video.projectId)
            return (
              <li key={video.projectId}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-sunk/60 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/projects/${video.projectId}?step=publish`}
                      className="line-clamp-1 text-[14px] font-semibold hover:underline"
                    >
                      {video.title}
                    </Link>
                    <p className="text-[12.5px] text-ink-3">
                      {[
                        video.format === 'portrait' ? 'Short' : null,
                        `Out ${timeAgo(video.publishedAt)}`,
                        open.length ? `${open.length} waiting` : 'All answered',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {unapproved.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        approve(
                          unapproved.map((c) => c.id),
                          true,
                        )
                      }
                    >
                      Approve all
                    </Button>
                  )}
                  {undrafted > 0 && (
                    <Button
                      variant="plain"
                      size="sm"
                      busy={drafting === video.projectId}
                      disabled={!canDraft || drafting !== null}
                      title={canDraft ? undefined : 'Add GEMINI_API_KEY to draft replies'}
                      onClick={() => draft(video)}
                      icon={<Sparkles className="size-3.5" />}
                    >
                      {undrafted > REPLIES.perDraft
                        ? `Draft the next ${REPLIES.perDraft}`
                        : `Draft ${plural(undrafted, 'reply', 'replies')}`}
                    </Button>
                  )}
                </div>
                <ul className="divide-y divide-line">
                  {[...open, ...(showing ? done : [])].map((comment) => (
                    <Comment
                      key={comment.id}
                      comment={comment}
                      url={commentUrl(video, comment.id)}
                      text={textOf(comment)}
                      approved={approved.has(comment.id)}
                      busy={sending === comment.id}
                      locked={sending !== null}
                      onText={(text) => setTexts((prev) => ({ ...prev, [comment.id]: text }))}
                      onBlur={() => save(comment)}
                      onApprove={(on) => approve([comment.id], on)}
                      onPost={() => post([{ comment, text: textOf(comment) }], comment.id)}
                      onStatus={(next) => setStatus(comment, next)}
                    />
                  ))}
                </ul>
                {done.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowDone((prev) => {
                        const next = new Set(prev)
                        if (showing) next.delete(video.projectId)
                        else next.add(video.projectId)
                        return next
                      })
                    }
                    className="w-full border-t border-line px-5 py-2.5 text-left text-[13px] text-ink-2 hover:bg-sunk/60 hover:text-ink"
                  >
                    {showing
                      ? 'Hide the answered and skipped'
                      : `Show ${[answered && `${answered} answered`, skipped && `${skipped} skipped`]
                          .filter(Boolean)
                          .join(' and ')}`}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {ready.length > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-[var(--radius-panel)] border-t border-line bg-panel px-5 py-3">
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            {plural(ready.length, 'reply', 'replies')} approved, to post from {channel.title} exactly as
            written above.
            {ready.length > REPLIES.perClick &&
              ` ${REPLIES.perClick} go out per click, to keep YouTube's daily quota for uploads.`}
          </p>
          <Button
            variant="go"
            size="sm"
            busy={sending === 'approved'}
            disabled={sending !== null}
            onClick={() =>
              post(
                ready.map((comment) => ({ comment, text: textOf(comment) })),
                'approved',
              )
            }
            icon={<Send className="size-3.5" />}
          >
            Post {plural(Math.min(ready.length, REPLIES.perClick), 'reply', 'replies')}
          </Button>
        </div>
      )}
    </Panel>
  )
}

function Comment({
  comment,
  url,
  text,
  approved,
  busy,
  locked,
  onText,
  onBlur,
  onApprove,
  onPost,
  onStatus,
}: {
  comment: ReplyCommentDTO
  url: string
  /** The reply as shown: what Post sends. */
  text: string
  approved: boolean
  busy: boolean
  locked: boolean
  onText: (text: string) => void
  onBlur: () => void
  onApprove: (on: boolean) => void
  onPost: () => void
  onStatus: (status: 'waiting' | 'skipped') => void
}) {
  const filled = Boolean(text.trim())
  return (
    <li className="px-5 py-3.5">
      <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-3">
        <span className="font-medium text-ink-2">{comment.author || 'A viewer'}</span>
        {comment.publishedAt && <span>· {timeAgo(comment.publishedAt)}</span>}
        {comment.likes > 0 && <span>· {plural(comment.likes, 'like')}</span>}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the comment on YouTube"
          className="ml-0.5 hover:text-ink"
        >
          <ExternalLink className="size-3" />
        </a>
      </p>
      <p className="mt-1 max-w-[80ch] text-[14px] leading-relaxed whitespace-pre-line">{comment.text}</p>

      {comment.status === 'waiting' && (
        <div
          className={cn(
            'mt-2.5 flex flex-col gap-2 border-l-2 pl-3',
            approved ? 'border-kodak' : 'border-line',
          )}
        >
          <Textarea
            value={text}
            onChange={(e) => onText(e.target.value)}
            onBlur={onBlur}
            rows={2}
            maxLength={10_000}
            disabled={busy}
            aria-label={`Your reply to ${comment.author || 'this viewer'}`}
            placeholder={
              comment.draft === null ? 'Write a reply, or have Gemini draft them' : 'Write your reply'
            }
            className="min-h-16"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn('flex items-center gap-1.5 text-[13px]', !filled && 'opacity-45')}>
              <input
                type="checkbox"
                checked={approved && filled}
                disabled={!filled || locked}
                onChange={(e) => onApprove(e.target.checked)}
                className="size-4 accent-kodak"
              />
              Approve
            </label>
            <Button
              variant="plain"
              size="sm"
              busy={busy}
              disabled={!filled || locked}
              onClick={onPost}
              icon={<MessageSquareReply className="size-3.5" />}
            >
              Post this reply
            </Button>
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => onStatus('skipped')}>
              Skip
            </Button>
          </div>
        </div>
      )}

      {comment.status === 'skipped' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <span>{comment.skipReason ? `Gemini would skip it: ${comment.skipReason}` : 'Skipped.'}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onStatus('waiting')}
            icon={<Undo2 className="size-3.5" />}
          >
            Reply anyway
          </Button>
        </div>
      )}

      {comment.status === 'replied' && (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-ok">
          <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            You replied: <span className="text-ink">{comment.draft}</span>
          </span>
        </p>
      )}
    </li>
  )
}
