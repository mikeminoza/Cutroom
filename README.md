# Cutroom

Turn a script, a voice-over and one image per scene into a finished YouTube video, then post it on a schedule.

1. **Brief**: topic, audience, format (16:9 video or 9:16 Short), art style.
2. **Characters** (optional): avatars plus a description that goes into every scene prompt that features them. Save a character to the library to reuse it in other videos.
3. **Script**: paste it, or let Gemini write it. It is split into timed scenes, each with an image prompt, a camera move, a transition (cut, crossfade or dip to black) and optional on-screen text.
4. **Voice-over**: upload your recording, or have an AI voice read the script (Gemini, free tier, or ElevenLabs). Every scene moves to where its words are spoken, and the pauses in the recording place each caption word. Fine-tune the cuts on the waveform.
5. **Images**: let Gemini paint every scene (the character reference images are attached for you), or copy each prompt into your own image tool and drop, paste or bulk-upload the results.
6. **Preview**: plays in the browser exactly as it will render (same motion, transitions, on-screen text and captions).
7. **Publish**: **Finish & schedule** starts the automatic part. The worker renders the MP4, saves it to Google Drive, writes the title, description, chapters and tags (learning from your best-performing titles), waits for your approval if you asked it to, uploads to YouTube with a publish time, then adds the thumbnail, captions and playlist and archives the project files. You get a message on Discord, Telegram or email when it needs you or is done.

Around the projects:

- **Ideas**: Gemini suggests video ideas for your niche or series, avoiding what you've already made. Pick the good ones and turn them into drafts, with their scripts written, in one go.
- **Channel niche** (Settings): describe your channel, how its narrator talks, its audience, tone, art style and usual length, and pick its main character from the Library. Every new video starts from it, with the character and their reference images already added; each video can still change its own copy.
- **Series** and **Library**: save a video's setup (brief, look, voice, music, characters, post settings) as a series and start every new episode from it. Saved characters can be added to any project.
- **Shorts from long videos**: pick a run of scenes (or let Gemini pick the best part) and get a 9:16 project with those pictures and that stretch of the voice-over and captions. Automatically too: right after a long video posts, Cutroom makes 1–3 Short drafts from its best moments (Settings → Shorts), ready for you to check and publish.
- **Performance**: views, likes, watch time and retention for every posted video, refreshed daily.
- **Several YouTube channels**: connect more than one, pick the channel per video, and each channel gets its own posting slots.

## Stack

| Part | What | Where it runs |
|---|---|---|
| `apps/web` | Next.js 16, React 19, Tailwind 4, TanStack Query, wavesurfer.js | Vercel (Hobby) |
| `apps/worker` | Node + Hono + ffmpeg: voice-overs and their timing, rendering, Drive and YouTube uploads | Render (free web service), or GitHub Actions (one run per job) |
| `packages/shared` | Types, Gemini and ElevenLabs calls, timing/caption/alignment/transition logic, storage, Google APIs | Used by both |
| Database | Neon Postgres in production, embedded Postgres (PGlite) locally | |
| Files | Vercel Blob in production, `.data/storage` locally | |
| Finished videos | Google Drive (`Cutroom/<project>` folder) | |

The web app owns the database. The worker never touches it: it claims a job from the web app (so two workers can never run the same job), then reports progress back over HTTP with `WORKER_SECRET`.

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

- `GEMINI_API_KEY`: free key from https://aistudio.google.com/apikey. Enables script writing, scene breakdown, AI voice-overs, voice-over timing, post details and ideas. AI pictures and thumbnails also use it, but image models need billing turned on for the key's Google Cloud project.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: lets you connect YouTube channels and Google Drive in Settings.
- Optional: `ELEVENLABS_API_KEY` for ElevenLabs voices, and the `NOTIFY_…` variables for Discord, Telegram or email messages.

Every variable is explained in **[docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)**: what it does, where to get it, which service needs it, and a complete local `.env` example.

## Deploy for free

**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** is the full click-by-click guide. It opens with a checklist of everything to prepare, which features need what, and which variable goes on Vercel or the worker:

1. Prepare three secrets (`WORKER_SECRET`, `CRON_SECRET`, `APP_PASSWORD`)
2. Get a Gemini API key
3. Google Cloud: enable the YouTube and Drive APIs, set up the consent screen, add the scopes and test users, create the OAuth client, publish the app
4. Vercel: import the repo with Root Directory `apps/web`, add the Neon database and a **public** Blob store, set the variables
5. Render: create the worker from `render.yaml`
6. Point the two at each other (`WORKER_URL` on Vercel, `APP_URL` on Render)
7. Log in, connect YouTube and Drive, set your posting slots
8. Do a test run
9. Optional extras: AI pictures, ElevenLabs voices, notifications, watch-time stats, and running the worker on GitHub Actions instead of Render
10. Upgrading a deployment made before these features: the Analytics API and scope, `CRON_SECRET`, deploying both services, and reconnecting your channel

It ends with a troubleshooting table for the common problems: redirect mismatch, a sleeping worker, mismatched secrets, an expired Google login, missing Blob token, YouTube quota, image billing and GitHub dispatch errors.

## Free-plan limits worth knowing

- **Render free:**
  - The worker sleeps after 15 minutes without requests and takes about a minute to wake when a job starts.
  - While a job runs, the worker calls its own public address every few minutes, which keeps it awake. You can close the tab.
  - If it is restarted mid-job, the job resumes from the last finished step when it wakes (or when the daily cron runs).
- **Render free CPU is small:** a tenth of a CPU renders a 6-minute 720p video in about half an hour. A video whose render runs past its posting time moves to the next free slot. The GitHub Actions worker (see DEPLOYMENT.md) has several CPU cores, renders the same video in minutes and never sleeps; it is free for public repositories and includes 2,000 minutes a month for private ones. Use it for 5–8-minute videos.
- **Vercel Blob is 1 GB:** with Drive connected, a posted video's working files and its MP4 move out of Blob once they are safe on Drive.
- **AI voice-overs on the free tier:** Gemini voices have per-minute and daily limits. Long scripts are recorded in parts, waiting out the per-minute limit; after the daily one, a retry continues from the last finished part. Uploading your own recording has no limits.
- **Vercel Hobby:**
  - For personal, non-commercial use.
  - Blob storage is 1 GB, so finished videos go to Drive, and working files can be cleared from Blob after posting (Settings → Storage).
  - Scheduled jobs run at most once a day, which is fine because YouTube handles the publish time.
- **Gemini free tier:** rate-limited, and Google may use free-tier inputs to improve its products. Text and voice (TTS) models are on it; image models are not, so AI pictures need billing on the key's project (about $0.04 a picture with the default model).
- **YouTube:** uploads have their own quota (100 a day). Scheduled videos are uploaded as private and YouTube makes them public at the slot time, so your computer and the worker can be off by then.

## Commands

| Command | What |
|---|---|
| `pnpm dev` | Web app and worker together |
| `pnpm test` | Tests: timing, alignment, captions, transitions, schedule, ASS subtitles, Gemini and ElevenLabs requests, and the server logic (jobs, channels, series, Shorts, notifications) against an embedded database |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm lint` | Biome |
| `pnpm --filter @cutroom/worker render:sample` | Renders two sample videos (transitions, on-screen text, captions) into `tmp/render-sample` |
| `pnpm --filter @cutroom/worker eval:timing` | Windows only: measures caption word timing against the true word times of Windows speech |
| `pnpm --filter @cutroom/web db:generate` | After changing `schema.ts`: new migration, embedded into the server bundle |

## Project layout

```
apps/web/src/app            pages and API routes
apps/web/src/components     UI (project/ holds the seven workspace steps)
apps/web/src/server         database, jobs, channels, series, Shorts, stats, notifications
apps/worker/src/jobs        retime, AI voice-over and publish pipelines
apps/worker/src/render      ffmpeg rendering and ASS captions
apps/worker/src/once.ts     runs one job and exits (the GitHub Actions worker)
packages/shared/src         shared logic used by both apps
.github/workflows           CI, and the GitHub Actions worker
```
