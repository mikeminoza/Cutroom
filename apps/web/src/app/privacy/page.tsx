import type { Metadata } from 'next'
import { LegalPage } from '@/components/legal-page'

export const metadata: Metadata = { title: 'Privacy policy' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="October 21, 2026">
      <p>
        Cutroom is a personal video studio. Its owner uses it to turn scripts, voice-overs and pictures into
        videos and post them to their own YouTube channel. This page explains what it does with data from your
        Google account when you connect it.
      </p>

      <h2>What Cutroom accesses</h2>
      <ul>
        <li>
          <strong>YouTube:</strong> uploading and scheduling videos you finish in Cutroom, adding their
          thumbnails, captions and playlists, and reading the views, likes, comments, watch time and retention
          of those videos for the Performance page.
        </li>
        <li>
          <strong>Google Drive:</strong> only the folders and files Cutroom creates (a Cutroom folder with
          your finished videos and project files). It cannot see anything else in your Drive.
        </li>
        <li>
          <strong>Your email address,</strong> to show which account is connected.
        </li>
      </ul>

      <h2>How it is used</h2>
      <p>
        Only to do what you ask in Cutroom: post your videos, save them to your Drive and show how they are
        doing. Your Google data is not sold, not used for advertising and not given to anyone else, apart from
        the AI feature described below.
      </p>

      <h2>Where it is kept</h2>
      <p>
        The sign-in tokens Google issues, your projects and their settings are stored in Cutroom’s own
        database. Working files (pictures, audio, rendered videos) are kept in Cutroom’s file storage until a
        video is posted and copied to your Drive. The services that run Cutroom (its hosting, database, file
        storage and the worker that renders videos) process this data only to run the app.
      </p>
      <h2>AI features</h2>
      <p>
        If AI features are turned on, what you use them on (scripts, scene descriptions, your voice-over
        recording when scenes are matched to it, and character pictures for AI images) is sent to Google’s
        Gemini API to produce the result. To suggest titles and video ideas in your channel’s style, the
        titles and view counts of your most-viewed videos are sent with it. On Gemini’s free tier, Google may
        use what is sent to improve its products. Nothing else from your Google account is sent.
      </p>

      <h2>Removing access and data</h2>
      <ul>
        <li>Disconnect YouTube or Drive in Cutroom’s Settings: the stored sign-in for it is deleted.</li>
        <li>
          Remove Cutroom’s access at any time at{' '}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
        </li>
        <li>
          Deleting a project deletes its files from Cutroom’s storage. Your videos on YouTube and Drive stay
          yours.
        </li>
      </ul>
    </LegalPage>
  )
}
