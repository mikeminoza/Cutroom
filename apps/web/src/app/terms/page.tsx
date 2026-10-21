import type { Metadata } from 'next'
import { LegalPage } from '@/components/legal-page'

export const metadata: Metadata = { title: 'Terms of service' }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="October 21, 2026">
      <p>
        Cutroom is a personal video studio, run by its owner for their own YouTube channel. By signing in to
        it you agree to these terms.
      </p>

      <h2>Your content</h2>
      <p>
        You are responsible for the scripts, recordings, pictures and music you use, and for what you post.
        Videos posted through Cutroom must follow{' '}
        <a href="https://www.youtube.com/t/terms">YouTube’s Terms of Service</a> and{' '}
        <a href="https://www.youtube.com/howyoutubeworks/policies/community-guidelines/">
          Community Guidelines
        </a>
        , including marking videos made for kids where that applies.
      </p>

      <h2>Your Google account</h2>
      <p>
        Cutroom acts on your YouTube channel and Google Drive only as described in the{' '}
        <a href="/privacy">privacy policy</a>. You can remove its access at any time at{' '}
        <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
      </p>

      <h2>No warranty</h2>
      <p>
        Cutroom is provided as is, without warranty of any kind. Keep your own copies of anything important;
        the owner is not liable for lost files, missed posting times or videos YouTube rejects.
      </p>

      <h2>Changes</h2>
      <p>These terms may change; the date at the top shows the latest version.</p>
    </LegalPage>
  )
}
