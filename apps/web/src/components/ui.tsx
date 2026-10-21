'use client'

import { Check, Copy, LoaderCircle, X } from 'lucide-react'
import Link from 'next/link'
import { DropdownMenu, Dialog as RDialog, Switch as RSwitch, Tooltip as RTooltip } from 'radix-ui'
import { forwardRef, useCallback, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/cn'
import type { Tone } from '@/lib/stage'

// ---------------------------------------------------------------- Button

type ButtonVariant = 'go' | 'plain' | 'ghost' | 'dark' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  go: 'bg-kodak text-on-kodak font-semibold hover:bg-kodak-deep active:translate-y-px',
  plain: 'bg-panel text-ink border border-line hover:border-line-strong hover:bg-sunk',
  ghost: 'text-ink-2 hover:text-ink hover:bg-ink/[0.05]',
  dark: 'bg-ink text-paper font-medium hover:bg-ink/90',
  danger: 'text-bad hover:bg-bad-wash',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-[38px] px-3.5 text-[14px] gap-2',
  lg: 'h-12 px-5 text-[15px] gap-2.5 wide',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  busy?: boolean
  icon?: React.ReactNode
}

const buttonBase =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[var(--radius-control)] transition-colors'

export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ReactNode
  disabled?: boolean
}

/**
 * A link that looks like a Button. (A <button> inside a link is invalid HTML,
 * and a disabled one there still lets the click through to the link.) App pages
 * go through Next's Link; API routes, downloads and other sites use a plain <a>.
 */
export function ButtonLink({
  href,
  variant = 'plain',
  size = 'md',
  icon,
  disabled,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const classes = cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(classes, 'pointer-events-none opacity-45')}>
        {icon}
        {children}
      </span>
    )
  }
  const page = href.startsWith('/') && !href.startsWith('/api/') && rest.download === undefined
  const Anchor = page ? Link : 'a'
  return (
    <Anchor href={href} className={classes} {...rest}>
      {icon}
      {children}
    </Anchor>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'plain', size = 'md', busy, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      className={cn(
        buttonBase,
        'disabled:pointer-events-none disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...rest}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------- Inputs

const fieldBase =
  'w-full rounded-[var(--radius-control)] border border-line bg-panel text-[14px] text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] focus:border-ink focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-kodak)_40%,transparent)] focus:outline-none disabled:bg-sunk disabled:text-ink-3'

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, 'h-[38px] px-3', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(fieldBase, 'min-h-24 px-3 py-2.5 leading-relaxed', className)}
        {...rest}
      />
    )
  },
)

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(fieldBase, 'h-[38px] appearance-none pr-9 pl-3')} {...rest}>
        {children}
      </select>
      <svg
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-ink-2"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  aside,
}: {
  label: string
  hint?: React.ReactNode
  error?: string | null
  children: React.ReactNode
  className?: string
  htmlFor?: string
  aside?: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {aside && <span className="text-[12px] text-ink-3">{aside}</span>}
      </div>
      {children}
      {error ? (
        <p className="text-[12.5px] text-bad">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] leading-snug text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  id,
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  label: string
  description?: string
  id?: string
}) {
  const fallback = useId()
  const switchId = id ?? fallback
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={switchId} className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium">{label}</span>
        {description && <span className="text-[12.5px] leading-snug text-ink-3">{description}</span>}
      </label>
      <RSwitch.Root
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-ink"
      >
        <RSwitch.Thumb className="block size-[18px] translate-x-[2px] rounded-full bg-panel transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-kodak" />
      </RSwitch.Root>
    </div>
  )
}

/** Mutually exclusive options shown side by side. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: React.ReactNode; hint?: string }[]
  className?: string
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-[var(--radius-control)] border border-line bg-sunk p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 rounded-[5px] px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors',
              active
                ? 'bg-panel font-medium text-ink shadow-[0_0_0_1px_var(--color-line-strong)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- Status

const toneStyles: Record<Tone, { pill: string; dot: string }> = {
  you: { pill: 'bg-kodak-wash text-kodak-ink', dot: 'bg-kodak' },
  run: { pill: 'bg-run-wash text-run', dot: 'bg-run animate-pulse-soft' },
  ok: { pill: 'bg-ok-wash text-ok', dot: 'bg-ok' },
  bad: { pill: 'bg-bad-wash text-bad', dot: 'bg-bad' },
  idle: { pill: 'bg-sunk text-ink-2', dot: 'bg-ink-3' },
}

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12.5px] font-medium whitespace-nowrap',
        toneStyles[tone].pill,
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', toneStyles[tone].dot)} />
      {children}
    </span>
  )
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-block size-2 rounded-full', toneStyles[tone].dot, className)} />
  )
}

export function ProgressBar({
  value,
  tone = 'run',
  className,
}: {
  value: number | null
  tone?: 'run' | 'you'
  className?: string
}) {
  const indeterminate = value === null
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value * 100)}
      className={cn('relative h-1.5 overflow-hidden rounded-full bg-ink/[0.08]', className)}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 rounded-full transition-[width] duration-500',
          tone === 'you' ? 'bg-kodak' : 'bg-run',
          indeterminate && 'w-1/3 animate-pulse-soft',
        )}
        style={indeterminate ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn('size-4 animate-spin', className)} />
}

// ---------------------------------------------------------------- Copy

export function CopyButton({
  text,
  label = 'Copy',
  done = 'Copied',
  className,
  variant = 'plain',
  size = 'sm',
}: {
  text: string
  label?: string
  done?: string
  className?: string
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Your browser blocked copying. Select the text and copy it manually.')
    }
  }
  return (
    <Button
      variant={variant}
      size={size}
      onClick={copy}
      className={className}
      icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    >
      {copied ? done : label}
    </Button>
  )
}

// ---------------------------------------------------------------- Dialog

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-film/50 data-[state=open]:animate-in dark:bg-black/60" />
        <RDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-panel)] border border-line bg-panel',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-4 pb-3.5">
            <div>
              <RDialog.Title className="wide text-[17px] font-semibold">{title}</RDialog.Title>
              {description && (
                <RDialog.Description className="mt-1 text-[13.5px] leading-snug text-ink-2">
                  {description}
                </RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="-mr-1.5 rounded-md p-1.5 text-ink-2 hover:bg-sunk hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </RDialog.Close>
          </div>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** Promise-based confirm dialog for destructive or overwriting actions. */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string
    body: React.ReactNode
    action: string
    danger?: boolean
    resolve: (value: boolean) => void
  } | null>(null)
  const confirm = useCallback(
    (options: { title: string; body: React.ReactNode; action: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setState({ ...options, resolve })),
    [],
  )
  const close = (value: boolean) => {
    state?.resolve(value)
    setState(null)
  }
  const element = (
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open) => !open && close(false)}
      title={state?.title ?? ''}
      description={state?.body}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={state?.danger ? 'dark' : 'go'} onClick={() => close(true)} autoFocus>
            {state?.action}
          </Button>
        </>
      }
    />
  )
  return { confirm, element }
}

// ---------------------------------------------------------------- Menu & tooltip

export function Menu({
  trigger,
  items,
  align = 'end',
}: {
  trigger: React.ReactNode
  items: ({ label: string; onSelect: () => void; danger?: boolean; icon?: React.ReactNode } | 'divider')[]
  align?: 'start' | 'end'
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-[var(--radius-control)] border border-line bg-panel p-1 text-[13.5px] shadow-[0_8px_24px_-12px_rgba(23,28,38,0.25)]"
        >
          {items.map((item, i) =>
            item === 'divider' ? (
              <DropdownMenu.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                onSelect={item.onSelect}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-[5px] px-2.5 py-1.5 outline-none data-[highlighted]:bg-sunk',
                  item.danger && 'text-bad data-[highlighted]:bg-bad-wash',
                )}
              >
                {item.icon}
                {item.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={300}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={6}
            className="z-50 max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-[12.5px] leading-snug text-paper"
          >
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  )
}

// ---------------------------------------------------------------- Drop zone

export function useFilePicker(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { open: () => inputRef.current?.click(), input }
}

export function DropZone({
  onFiles,
  accept,
  multiple = false,
  children,
  className,
  activeClassName = 'border-ink bg-kodak-wash',
  disabled,
}: {
  onFiles: (files: File[]) => void
  accept: string
  multiple?: boolean
  children: (state: { open: () => void; dragging: boolean }) => React.ReactNode
  className?: string
  activeClassName?: string
  disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const picker = useFilePicker(accept, multiple, onFiles)
  const matches = (file: File) =>
    accept.split(',').some((rule) => {
      const r = rule.trim()
      return r.endsWith('/*')
        ? file.type.startsWith(r.slice(0, -1))
        : file.type === r || file.name.endsWith(r)
    })
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target only; the button inside opens the file picker
    <div
      className={cn(className, dragging && activeClassName)}
      onDragEnter={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        depth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        if (disabled) return
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        const files = Array.from(e.dataTransfer.files).filter(matches)
        if (files.length === 0) {
          toast.error('That file type is not accepted here.')
          return
        }
        onFiles(multiple ? files : files.slice(0, 1))
      }}
    >
      {picker.input}
      {children({ open: picker.open, dragging })}
    </div>
  )
}

// ---------------------------------------------------------------- Layout bits

export function Panel({
  children,
  className,
  title,
  description,
  actions,
}: {
  children: React.ReactNode
  className?: string
  title?: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className={cn('rounded-[var(--radius-panel)] border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="wide text-[16px] font-semibold">{title}</h2>}
            {description && (
              <p className="mt-1 max-w-[68ch] text-[13.5px] leading-snug text-ink-2">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-panel px-1 py-px text-[11px] font-medium text-ink-2">
      {children}
    </kbd>
  )
}
