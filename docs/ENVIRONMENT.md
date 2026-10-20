# Environment variables

Cutroom has two programs that read environment variables:

- **Web app** (`apps/web`): Next.js, deployed to Vercel.
- **Worker** (`apps/worker`): Node + ffmpeg, deployed to Render.

Locally both read a single `.env` file at the repository root. In production you set the same values in Vercel and in Render. [DEPLOYMENT.md](DEPLOYMENT.md) walks through where to click.

## At a glance

| Variable | Web (Vercel) | Worker (Render) | Required | Example |
|---|---|---|---|---|
| `GEMINI_API_KEY` | ✓ | ✓ | For AI features | `AIzaSy…` |
| `GEMINI_MODEL` | ✓ | ✓ | No | `gemini-3.8-flash` |
| `GEMINI_TTS_MODEL` | ✓ | ✓ | No | `gemini-3.8-flash-tts` |
| `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_SIZE` | ✓ | – | No | `gemini-3.1-flash-lite-image`, `2K` |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` | ✓ | ✓ | No | `sk_…`, `eleven_multilingual_v2` |
| `WORKER_SECRET` | ✓ | ✓ | **Yes**, same value in both | `3f9c…` (64 random hex characters) |
| `GOOGLE_CLIENT_ID` | ✓ | ✓ | For YouTube and Drive | `1234-abc.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | ✓ | ✓ | For YouTube and Drive | `GOCSPX-…` |
| `BLOB_READ_WRITE_TOKEN` | ✓ (from the Blob store) | ✓ (copy it) | Production only | `vercel_blob_rw_…` |
| `DATABASE_URL` | ✓ (added by Neon) | – | Production only | `postgresql://…neon.tech/neondb?sslmode=require` |
| `WORKER_URL` | ✓ | – | **Yes** | `https://cutroom-worker.onrender.com` |
| `APP_URL` | ✓ | ✓ | **Yes** on the worker, recommended on web | `https://cutroom.vercel.app` |
| `APP_PASSWORD` | ✓ | – | **Yes** in production | a long password |
| `SESSION_SECRET` | ✓ | – | No | 64 random hex characters |
| `CRON_SECRET` | ✓ | – | **Yes** when `APP_PASSWORD` is set | 32 random hex characters |
| `NOTIFY_DISCORD_WEBHOOK_URL` | ✓ | – | No | `https://discord.com/api/webhooks/…` |
| `NOTIFY_TELEGRAM_BOT_TOKEN`, `NOTIFY_TELEGRAM_CHAT_ID` | ✓ | – | No | `123456:ABC…`, `987654321` |
| `RESEND_API_KEY`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM` | ✓ | – | No | `re_…`, `you@example.com` |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO` | ✓ | – | Only for the GitHub Actions worker | `github_pat_…`, `you/Cutroom` |
| `GITHUB_WORKFLOW_FILE`, `GITHUB_BRANCH`, `WORKER_MODE` | ✓ | – | No | `worker.yml`, `main`, `render` |
| `FFMPEG_PATH`, `FFPROBE_PATH` | – | ✓ | No | `C:\ffmpeg\bin\ffmpeg.exe` |
| `FFMPEG_THREADS` | – | ✓ | No | `1` |
| `WORKER_PUBLIC_URL` | – | ✓ | No | `https://my-worker.example.com` |
| `STORAGE_DIR`, `PGLITE_DIR` | local only | local only | No | `D:\cutroom-data\storage` |
| `PORT` | – | set by Render | No | `10000` |

**Values that must match between the two services:**

| On the web app (Vercel) | On the worker (Render) |
|---|---|
| `WORKER_SECRET` | `WORKER_SECRET`, the identical value |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TTS_MODEL` | the same values |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL` (if used) | the same values |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the same values |
| `BLOB_READ_WRITE_TOKEN` | the same value |
| `WORKER_URL` = the worker's Render URL | – |
| – | `APP_URL` = the web app's Vercel URL |

## Every variable in detail

### `GEMINI_API_KEY`

Lets Cutroom use Gemini to:
- write scripts
- split them into scenes
- read the script aloud as an AI voice-over
- listen to an uploaded voice-over to time the scenes
- write titles, descriptions, chapters and tags
- suggest video ideas, and pick the best part of a video for a Short
- paint scene pictures and thumbnails (needs billing, see `GEMINI_IMAGE_MODEL`)

Without it, everything else still works: split the script by sentence, spread scenes evenly over the voice-over, and write the post details yourself. If the worker reaches "Write post details" with no key, it falls back to the project title and topic.

How to get it (free):
1. Go to https://aistudio.google.com/apikey and sign in with your Google account.
2. Click **Create API key**. Pick an existing Google Cloud project or let it create one.
3. Copy the key, which starts with `AIza`.
4. To stay on the **free tier**, don't turn on billing for that Google Cloud project. With billing on, usage is charged.

The free tier has rate limits. If you hit one, the app says "Gemini free-tier limit reached. Wait a minute and try again."

### `GEMINI_MODEL`

The Gemini text model. It defaults to `gemini-3.8-flash`. Google renames models from time to time. If a Gemini call fails with "model not found", pick a current Flash model from https://ai.google.dev/gemini-api/docs/models and set it here on **both** services.

### `GEMINI_TTS_MODEL`

The voice model for AI voice-overs. It defaults to `gemini-3.8-flash-tts`, which is on the free tier. The 30 prebuilt voices are listed on the Voice-over step and in Settings → AI voice. Set it on **both** services: the worker records the voice-over.

### `GEMINI_IMAGE_MODEL` and `GEMINI_IMAGE_SIZE`

The model that paints scene pictures and thumbnails. It defaults to `gemini-3.1-flash-lite-image`, the cheapest one (about $0.04 a picture).

**Image models are not on Gemini's free tier.** To use them, turn on billing for the Google Cloud project your `GEMINI_API_KEY` belongs to (https://aistudio.google.com → your key's project → Billing). Without billing, generating a picture says "This Gemini model is not on the free tier". Everything else keeps working; you can still copy the prompts into another image tool.

- Other models: `gemini-nano-banana-2.1` (best quality) or `gemini-3.1-flash-image`.
- `GEMINI_IMAGE_SIZE`: optional, `1K` (default), `2K` or `4K`. Larger pictures look sharper at 1080p but cost more. The lite model only makes `1K`.

Only the web app makes pictures, so these are only needed on Vercel.

### `ELEVENLABS_API_KEY` and `ELEVENLABS_MODEL`

Optional and paid. Adds your ElevenLabs voices to the AI voice-over. ElevenLabs reports the exact time of every word, so captions line up perfectly.

1. Sign in at https://elevenlabs.io and create an API key at https://elevenlabs.io/app/settings/api-keys, with access to text-to-speech and voices.
2. Set `ELEVENLABS_API_KEY` on **both** services. The web app lists your voices; the worker records the voice-over.
3. `ELEVENLABS_MODEL` is optional. It defaults to `eleven_multilingual_v2`.

### `WORKER_SECRET`

A shared password between the web app and the worker:
- The web app sends it when it starts a job.
- The worker sends it back with every progress report.

Use a long random string, and the **same value on both services**.

Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If the two values differ, jobs never start: Settings shows the worker as online, but every job stays "Waiting for the worker".

### `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

The OAuth client you create in Google Cloud. They let you connect your YouTube channel and Google Drive in **Settings**. Step-by-step setup: [DEPLOYMENT.md → Google Cloud](DEPLOYMENT.md#3-google-cloud-youtube-and-drive-sign-in).

- The client ID ends in `.apps.googleusercontent.com`.
- The secret starts with `GOCSPX-`.
- Set both on **both** services. The worker needs them to renew the YouTube and Drive login during uploads.

### `BLOB_READ_WRITE_TOKEN`

Vercel Blob storage for avatars, voice-overs, scene images, thumbnails and music.

- **Locally:** leave it empty. Files go to `.data/storage`.
- **On Vercel:** connecting a Blob store adds Blob credentials to the project. Newer stores connect with `BLOB_STORE_ID` (Vercel OIDC); Cutroom also needs `BLOB_READ_WRITE_TOKEN`, because browser uploads use it to issue upload tokens. If the project doesn't have it, copy the read-write token from the Blob store's page and add it yourself. **Settings → Storage** in the app turns red when it is missing.
- **On Render:** copy the same token. The worker runs outside Vercel, so it can only use the read-write token. It needs it to read the uploaded files, save the caption file, and save the rendered video when Google Drive is not connected.

The store must be created with **Public** access. The access mode can't be changed later, and Cutroom stores files as public blobs with unguessable URLs.

### `DATABASE_URL`

Postgres connection string.

- **Locally:** leave it empty. An embedded Postgres (PGlite) runs inside the web app and stores its data in `.data/pglite`.
- **On Vercel:** added automatically when you connect a Neon database from the Vercel Marketplace.

Tables are created automatically on the first request after deploying. There is no migration command to run.

### `WORKER_URL`

Where the web app reaches the worker.

- **Locally:** `http://localhost:8787`.
- **In production:** the worker's Render URL, for example `https://cutroom-worker.onrender.com`, with no trailing slash.

### `APP_URL`

The public address of the web app.

- **On the worker (required):** this is how the worker finds the web app to load jobs and report progress. Locally use `http://localhost:3000`. In production use your Vercel production URL, for example `https://cutroom.vercel.app`.
- **On the web app (recommended in production):** builds the Google sign-in return address (`<APP_URL>/api/google/callback`). Set it to the same production URL so connecting Google always uses the address registered in Google Cloud, even if you open the app through another Vercel URL. If you leave it unset, the app uses the address in the browser bar.

### `APP_PASSWORD`

The password for the login page. When it's empty, anyone who knows the address can use the app, so **set it before deploying**. Locally you can leave it empty to skip the login page.

### `SESSION_SECRET`

Signs the login cookie. Optional: if it's empty, a key derived from `APP_PASSWORD` is used. Set it if you want to change the password without signing out existing sessions, or the other way round.

### `CRON_SECRET`

Protects `/api/cron`, the daily job that wakes the worker and nudges any upload that stalled while no tab was open. When `CRON_SECRET` is set, Vercel sends it automatically with every scheduled call. Any random string works.

If `APP_PASSWORD` is set but `CRON_SECRET` is not, `/api/cron` refuses every call, so a password-protected app never leaves it open. The daily check then doesn't run: stalled uploads wait until you open the app, and Performance stats only refresh when you press Refresh.

### Notifications: `NOTIFY_DISCORD_WEBHOOK_URL`, `NOTIFY_TELEGRAM_BOT_TOKEN`, `NOTIFY_TELEGRAM_CHAT_ID`, `RESEND_API_KEY`, `NOTIFY_EMAIL_TO`, `NOTIFY_EMAIL_FROM`

Optional, web app only. Cutroom sends a message when a video waits for your approval, when something fails, and when a video is posted or scheduled (choose which in **Settings → Notifications**). It also tells you about a job that has not moved for an hour. Set up any or all of these:

- **Discord:** in your server, **Server settings → Integrations → Webhooks → New webhook**, pick a channel, **Copy webhook URL**, and set it as `NOTIFY_DISCORD_WEBHOOK_URL`.
- **Telegram:**
  1. Message [@BotFather](https://t.me/BotFather), send `/newbot` and follow the steps. It gives you the bot token: `NOTIFY_TELEGRAM_BOT_TOKEN`.
  2. Send your new bot any message, then open `https://api.telegram.org/bot<token>/getUpdates`. The number under `"chat":{"id":` is `NOTIFY_TELEGRAM_CHAT_ID`.
- **Email** (through Resend, free for 100 emails a day):
  1. Create an API key at https://resend.com/api-keys: `RESEND_API_KEY`.
  2. `NOTIFY_EMAIL_TO`: your address (several: separate with commas).
  3. `NOTIFY_EMAIL_FROM`: optional. Without your own domain verified in Resend, leave it empty: the default `Cutroom <onboarding@resend.dev>` can only send to the email address of your Resend account.

After a redeploy, **Settings → Connections → Notifications → Send a test** checks every channel.

### GitHub Actions worker: `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, `GITHUB_WORKFLOW_FILE`, `GITHUB_BRANCH`, `WORKER_MODE`

Optional, web app only. When `GITHUB_DISPATCH_TOKEN` and `GITHUB_REPO` are set, jobs run on GitHub Actions (`.github/workflows/worker.yml`) instead of the worker at `WORKER_URL`. Each job starts its own run: more CPU than Render's free plan, and nothing to keep awake. Setup: [DEPLOYMENT.md → Optional: the worker on GitHub Actions](DEPLOYMENT.md#11-optional-the-worker-on-github-actions).

- `GITHUB_DISPATCH_TOKEN`: a fine-grained personal access token with access to this repository only and the **Actions: Read and write** permission.
- `GITHUB_REPO`: `owner/name`, for example `you/Cutroom`.
- `GITHUB_WORKFLOW_FILE`: optional, the workflow file name. Defaults to `worker.yml`. (Not `GITHUB_WORKFLOW`: GitHub Actions sets that one itself.)
- `GITHUB_BRANCH`: optional, the branch whose workflow runs. Defaults to `main`.
- `WORKER_MODE`: optional. Set to `render` to keep using `WORKER_URL` while the GitHub variables are set.

The run itself reads its secrets from the repository (**Settings → Secrets and variables → Actions**), not from Vercel.

### `WORKER_PUBLIC_URL` (worker)

Optional. While a job runs, the worker calls its own public address every few minutes so a host that sleeps idle services (like Render's free plan) keeps it awake until the job is done. Render provides `RENDER_EXTERNAL_URL` automatically, so you only need this on other hosts.

### `FFMPEG_PATH`, `FFPROBE_PATH`, `FFMPEG_THREADS` (worker)

- **Paths:** only needed when ffmpeg is not on your `PATH`. The Docker image used on Render already includes ffmpeg.
- **`FFMPEG_THREADS`:** caps how many CPU threads a render uses. The default is the number of available cores, up to 4. On Render's free plan leave it empty or set `1`.

### `STORAGE_DIR`, `PGLITE_DIR` (local only)

Move local files and the local database somewhere other than `.data/`. Rarely needed.

### `PORT` (worker)

Render sets this for you. Locally the worker uses `8787`.

## Local setup

1. Copy the template:
   ```bash
   cp .env.example .env
   ```
2. Generate a worker secret and paste it into `WORKER_SECRET=` in `.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. Leave these as they are:
   - `WORKER_URL=http://localhost:8787`
   - `APP_URL=http://localhost:3000`
4. Leave these empty, so the app uses local storage, a local database and no login page:
   - `DATABASE_URL`
   - `BLOB_READ_WRITE_TOKEN`
   - `APP_PASSWORD`
5. Optional: add `GEMINI_API_KEY` for the AI features.
6. Optional: add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and add `http://localhost:3000/api/google/callback` as a redirect URI in Google Cloud.
7. Start everything:
   ```bash
   pnpm dev
   ```

`.env` is in `.gitignore`. Never commit it.

## A complete local `.env`

```dotenv
GEMINI_API_KEY=AIzaSy-your-key
GEMINI_MODEL=gemini-3.8-flash
ELEVENLABS_API_KEY=
WORKER_SECRET=paste-64-random-hex-characters-here
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
BLOB_READ_WRITE_TOKEN=
WORKER_URL=http://localhost:8787
DATABASE_URL=
APP_PASSWORD=
SESSION_SECRET=
CRON_SECRET=
APP_URL=http://localhost:3000
```

## Changing a variable later

- **Vercel:** environment variable changes apply to new deployments only. After saving, open **Deployments**, click **⋯** on the latest one, then **Redeploy**.
- **Render:** when you save environment variables, pick the option that also deploys. The worker restarts with the new values.
- **Locally:** restart `pnpm dev`.
