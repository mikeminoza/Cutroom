'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { Wordmark } from '@/components/app-shell'
import { Button, Field, Input } from '@/components/ui'
import { api, errorText } from '@/lib/api'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/api/auth/login', { password })
      const next = params.get('next')
      router.replace(next?.startsWith('/') ? next : '/')
      router.refresh()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-[var(--radius-panel)] border border-line bg-panel px-6 py-7"
    >
      <Wordmark />
      <p className="mt-4 text-[14px] text-ink-2">Enter your password to open the studio.</p>
      <Field label="Password" htmlFor="password" error={error} className="mt-5">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
          autoFocus
        />
      </Field>
      <Button type="submit" variant="go" busy={busy} disabled={!password} className="mt-5 w-full">
        Sign in
      </Button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}
