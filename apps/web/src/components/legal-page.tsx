import Link from 'next/link'
import { Wordmark } from './app-shell'

/** A public page of plain text (privacy policy, terms): readable without signing in. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  const contact = process.env.CONTACT_EMAIL?.trim()
  return (
    <main className="mx-auto max-w-[68ch] px-4 py-10 sm:py-16">
      <Link href="/" className="inline-block rounded-md">
        <Wordmark />
      </Link>
      <h1 className="display mt-10 text-[32px]">{title}</h1>
      <p className="mt-2 text-[13px] text-ink-3">Last updated {updated}</p>
      <div className="mt-8 flex flex-col gap-4 text-[15px] leading-relaxed text-ink-2 [&_h2]:wide [&_h2]:mt-4 [&_h2]:text-[17px] [&_h2]:font-semibold [&_h2]:text-ink [&_a]:font-medium [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1">
        {children}
        <h2>Contact</h2>
        <p>
          {contact ? (
            <>
              Questions about this page: <a href={`mailto:${contact}`}>{contact}</a>.
            </>
          ) : (
            'Questions about this page go to the support email shown on the Google sign-in screen for Cutroom.'
          )}
        </p>
      </div>
      <p className="mt-12 flex gap-4 text-[13px] text-ink-3">
        <Link href="/privacy" className="hover:text-ink">
          Privacy policy
        </Link>
        <Link href="/terms" className="hover:text-ink">
          Terms of service
        </Link>
      </p>
    </main>
  )
}
