# Cutroom

Turn a script, a voice-over and one image per scene into a finished YouTube video, then post it on a schedule.

1. **Brief**: topic, audience, format (16:9 video or 9:16 Short), art style.
2. **Characters** (optional): avatars plus a description that goes into every scene prompt that features them.
3. **Script**: paste it, or let Gemini write it. It is split into timed scenes, each with an image prompt.
4. **Voice-over**: upload it. Gemini listens and moves every scene to where its words are spoken. Fine-tune the cuts on the waveform.
5. **Images**: copy each prompt into your image tool with the reference images, then drop, paste or bulk-upload the results.
6. **Preview**: plays in the browser exactly as it will render (same motion, same captions).
7. **Publish**: **Finish & schedule** starts the automatic part. The worker renders the MP4, saves it to Google Drive, writes the title, description, chapters and tags, waits for your approval if you asked it to, uploads to YouTube with a publish time, then adds the thumbnail, captions and playlist and archives the project files.

## Stack

| Part | What | Where it runs |
|---|---|---|
| `apps/web` | Next.js 16, React 19, Tailwind 4, TanStack Query, wavesurfer.js | Vercel (Hobby) |
| `apps/worker` | Node + Hono + ffmpeg: voice-over timing, rendering, Drive and YouTube uploads | Render (free web service) |
| `packages/shared` | Types, Gemini calls, timing/caption/alignment logic, storage, Google APIs | Used by both |
| Database | Neon Postgres in production, embedded Postgres (PGlite) locally | |
| Files | Vercel Blob in production, `.data/storage` locally | |
| Finished videos | Google Drive (`Cutroom/<project>` folder) | |

The web app owns the database. The worker never touches it: it reads a job from the web app and reports progress back over HTTP with `WORKER_SECRET`.

## Run it locally

Requirements: Node 24, pnpm 10, ffmpeg on your PATH (`winget install Gyan.FFmpeg` on Windows).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm dev
```

Open http://localhost:3000. `pnpm dev` starts the web app (port 3000) and the worker (port 8787) together. With an empty `.env` everything except the AI and Google features works: split scripts by sentence, spread scenes over the voice-over, upload images, preview and render.

Add these to `.env` to switch on the rest:

- `GEMINI_API_KEY`: free key from https://aistudio.google.com/apikey. Enables script writing, scene breakdown, voice-over timing and post details.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: lets you connect YouTube and Google Drive in Settings.

Every variable is explained in **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**: what it does, where to get it, which service needs it, and a complete local `.env` example.

## Deploy for free

**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** is the full click-by-click guide:

1. Prepare three secrets (`WORKER_SECRET`, `CRON_SECRET`, `APP_PASSWORD`)
2. Get a Gemini API key
3. Google Cloud: enable the YouTube and Drive APIs, set up the consent screen, add the scopes and test users, create the OAuth client, publish the app
4. Vercel: import the repo with Root Directory `apps/web`, add the Neon database and a **public** Blob store, set the variables
5. Render: create the worker from `render.yaml`
6. Point the two at each other (`WORKER_URL` on Vercel, `APP_URL` on Render)
7. Log in, connect YouTube and Drive, set your posting slots
8. Do a test run

It ends with a troubleshooting table for the common problems: redirect mismatch, a sleeping worker, mismatched secrets, an expired Google login, missing Blob token and YouTube quota.

## Free-plan limits worth knowing

- **Render free:**
  - The worker sleeps after 15 minutes without requests and takes about a minute to wake.
  - While a job runs, the open dashboard checks on it every few seconds, which keeps it awake. **Keep a Cutroom tab open until an upload finishes.**
  - If it does sleep, the job resumes from the last finished step when it wakes (or when the daily cron runs).
- **Render free CPU is small.** 720p is the default for that reason. Long videos at 1080p can take a while.
- **Vercel Hobby:**
  - For personal, non-commercial use.
  - Blob storage is 1 GB, so finished videos go to Drive, and working files can be cleared from Blob after posting (Settings → Storage).
  - Scheduled jobs run at most once a day, which is fine because YouTube handles the publish time.
- **Gemini free tier:** rate-limited, and Google may use free-tier inputs to improve its products.
- **YouTube:** uploads have their own quota (100 a day). Scheduled videos are uploaded as private and YouTube makes them public at the slot time, so your computer and the worker can be off by then.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Web app and worker together |
| `pnpm test` | Unit tests (timing, alignment, captions, schedule, ASS subtitles) |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` | Biome |
| `pnpm --filter @cutroom/worker render:sample` | Renders two sample videos into `tmp/render-sample` |
| `pnpm --filter @cutroom/web db:generate` | After changing `schema.ts`: new migration, embedded into the server bundle |

## Project layout

```
apps/web/src/app            pages and API routes
apps/web/src/components     UI (project/ holds the seven workspace steps)
apps/web/src/server         database, jobs, auth, settings
apps/worker/src/jobs        retime and publish pipelines
apps/worker/src/render      ffmpeg rendering and ASS captions
packages/shared/src         shared logic used by both apps
```
