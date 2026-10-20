# Deploying Cutroom for free

This guide takes you from the GitHub repository to a live app that posts to YouTube on its own. Follow the sections in order. Every variable mentioned is explained in [ENVIRONMENT.md](ENVIRONMENT.md).

**What you end up with**

| Piece | Service | Cost |
|---|---|---|
| Web app (pages + API) | Vercel, Hobby plan | Free |
| Database | Neon Postgres via the Vercel Marketplace | Free plan |
| Working files (images, audio) | Vercel Blob | Free up to 1 GB |
| Worker (timing, rendering, uploads) | Render, free web service | Free |
| AI | Gemini API, free tier | Free |
| Finished videos | Google Drive (your account) | Free up to 15 GB, shared with Gmail and Photos |
| Posting | YouTube Data API | Free |

**Accounts you need:** GitHub, Google (with a YouTube channel), Vercel and Render. Sign up for Vercel and Render with GitHub; it makes connecting the repository one click.

**Time:** about 45 minutes the first time.

---

## Contents

- [Before you start: checklist](#before-you-start-checklist)
1. [Prepare three secrets](#1-prepare-three-secrets)
2. [Gemini API key](#2-gemini-api-key)
3. [Google Cloud: YouTube and Drive sign-in](#3-google-cloud-youtube-and-drive-sign-in)
4. [Vercel: the web app, database and storage](#4-vercel-the-web-app-database-and-storage)
5. [Render: the worker](#5-render-the-worker)
6. [Connect the two](#6-connect-the-two)
7. [First login and connecting your channel](#7-first-login-and-connecting-your-channel)
8. [Test run](#8-test-run)
9. [Updating the app later](#9-updating-the-app-later)
10. [Optional extras](#10-optional-extras)
11. [Optional: the worker on GitHub Actions](#11-optional-the-worker-on-github-actions)
12. [Troubleshooting](#12-troubleshooting)

---

## Before you start: checklist

Tick these off as you go. The required list gives you a working app that posts to YouTube. Each optional feature can be added on the day you want it.

### Required

| Done | What | Where it comes from | Step |
|---|---|---|---|
| ☐ | `WORKER_SECRET`, `CRON_SECRET`, `APP_PASSWORD` | you make them | [1](#1-prepare-three-secrets) |
| ☐ | `GEMINI_API_KEY` | Google AI Studio | [2](#2-gemini-api-key) |
| ☐ | **YouTube Data API v3**, **YouTube Analytics API** and **Google Drive API** turned on | Google Cloud console | [3.2](#32-turn-on-the-apis) |
| ☐ | Consent screen with all six scopes, yourself as a test user, app published | Google Cloud console | [3.3–3.7](#33-set-up-the-consent-screen) |
| ☐ | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | the OAuth client | [3.6](#36-create-the-oauth-client) |
| ☐ | Neon database (`DATABASE_URL`) and a **public** Blob store (`BLOB_READ_WRITE_TOKEN`) | Vercel → Storage | [4.3–4.5](#43-add-the-database-neon) |
| ☐ | `APP_URL`, and `<APP_URL>/api/google/callback` registered with Google | Vercel, then Google Cloud | [4.6–4.7](#46-find-your-production-address) |
| ☐ | `WORKER_URL` | your Render address | [6](#6-connect-the-two) |

### Optional features

| Feature | What you need first | Variables | Set on |
|---|---|---|---|
| AI pictures and thumbnails | Billing on the Google Cloud project of your Gemini key (about $0.04 a picture) | none required; `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_SIZE` to change the model | Vercel |
| AI voice-overs with Gemini voices | Nothing: they use your Gemini key on the free tier | none required; `GEMINI_TTS_MODEL` to change the model | worker |
| AI voice-overs with ElevenLabs voices | An ElevenLabs API key with **Text to Speech** and **Voices** access | `ELEVENLABS_API_KEY`; `ELEVENLABS_MODEL` optional | Vercel **and** worker |
| Discord messages | A webhook for one of your channels (channel → **Edit Channel → Integrations → Webhooks**) | `NOTIFY_DISCORD_WEBHOOK_URL` | Vercel |
| Telegram messages | A bot from **@BotFather**, and your chat id | `NOTIFY_TELEGRAM_BOT_TOKEN`, `NOTIFY_TELEGRAM_CHAT_ID` | Vercel |
| Email messages | A Resend API key (https://resend.com) | `RESEND_API_KEY`, `NOTIFY_EMAIL_TO`; `NOTIFY_EMAIL_FROM` optional | Vercel |
| Watch time and retention on **Performance** | The YouTube Analytics API and its scope, both already in the required list | none | – |
| More than one YouTube channel | Nothing: connect each one in **Settings** | none | – |
| The worker on GitHub Actions instead of Render | A fine-grained GitHub token with **Actions: Read and write** | `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO`, plus repository secrets | Vercel and GitHub ([11](#11-optional-the-worker-on-github-actions)) |

How to get each value is in [ENVIRONMENT.md](ENVIRONMENT.md). After adding a variable, redeploy that service ([9](#9-updating-the-app-later)).

### Where each variable goes

"Worker" means Render, or the repository's Actions secrets if you run the worker on GitHub Actions.

| Variable | Vercel | Worker | Notes |
|---|---|---|---|
| `APP_PASSWORD` | ✓ | | |
| `CRON_SECRET` | ✓ | | Required whenever `APP_PASSWORD` is set |
| `SESSION_SECRET` | optional | | |
| `WORKER_SECRET` | ✓ | ✓ | Same value in both |
| `APP_URL` | ✓ | ✓ | Same value in both |
| `WORKER_URL` | ✓ | | Render address; not needed with GitHub Actions |
| `DATABASE_URL` | added by Neon | | |
| `BLOB_READ_WRITE_TOKEN` | added by Blob | ✓ | Same value in both |
| `GEMINI_API_KEY` | ✓ | ✓ | |
| `GEMINI_MODEL` | optional | optional | Defaults to `gemini-3.8-flash` |
| `GEMINI_TTS_MODEL` | | optional | Defaults to `gemini-3.8-flash-tts` |
| `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_SIZE` | optional | | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✓ | ✓ | |
| `ELEVENLABS_API_KEY` | optional | optional | Set in both or neither |
| `ELEVENLABS_MODEL` | | optional | |
| `NOTIFY_…`, `RESEND_API_KEY` | optional | | |
| `GITHUB_DISPATCH_TOKEN`, `GITHUB_REPO` | optional | | Only for the GitHub Actions worker |
| `WORKER_MODE` | optional | | `render` keeps the Render worker while the GitHub variables are set |
| `FFMPEG_THREADS` | | optional | |

## 1. Prepare three secrets

Open a notes file (or your password manager) and create three values. You'll paste them into Vercel and Render.

| Name | How to make it |
|---|---|
| `WORKER_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | the same command again, for a different value |
| `APP_PASSWORD` | a password you'll type to log in |

No Node installed? Any password generator works. Use 40 or more random letters and numbers.

All three are required. Without `CRON_SECRET`, a password-protected app turns the daily check off: that check resumes uploads that stalled while no tab was open, and refreshes the Performance numbers.

## 2. Gemini API key

1. Go to https://aistudio.google.com/apikey and sign in.
2. Click **Create API key**.
3. Choose **Create API key in new project**, or pick a Google Cloud project you already have.
4. Copy the key (it starts with `AIza`) into your notes as `GEMINI_API_KEY`.

To stay free, don't turn on billing for that Google Cloud project.

## 3. Google Cloud: YouTube and Drive sign-in

This creates the "Sign in with Google" client Cutroom uses to post to your channel and save to your Drive.

### 3.1 Create a project

1. Open https://console.cloud.google.com.
2. In the top bar, click the project picker, then **New project**.
3. Name it `Cutroom`, then click **Create**. Make sure it's selected in the project picker afterwards.

You can reuse the Gemini project instead if you like.

### 3.2 Turn on the APIs

1. Menu ☰ → **APIs & Services → Library**.
2. Search **YouTube Data API v3**, open it, and click **Enable**.
3. Go back to the Library, search **Google Drive API**, open it, and click **Enable**.
4. Go back again, search **YouTube Analytics API**, open it, and click **Enable**. The Performance page reads watch time and retention from it.

### 3.3 Set up the consent screen

1. Menu ☰ → **Google Auth platform → Branding**. If you see "Google Auth platform not configured yet", click **Get started**.
2. **App information:**
   - App name: `Cutroom`
   - User support email: your email

   Click **Next**.
3. **Audience:** choose **External**, then **Next**.
4. **Contact information:** your email, then **Next**.
5. Tick the user data policy agreement, click **Continue**, then **Create**.

### 3.4 Add the scopes (the permissions Cutroom asks for)

1. **Google Auth platform → Data Access → Add or remove scopes.**
2. Scroll to **Manually add scopes**, paste these six lines, then click **Add to table**:
   ```
   https://www.googleapis.com/auth/youtube.upload
   https://www.googleapis.com/auth/youtube.force-ssl
   https://www.googleapis.com/auth/yt-analytics.readonly
   https://www.googleapis.com/auth/drive.file
   openid
   https://www.googleapis.com/auth/userinfo.email
   ```
3. Click **Update**, then **Save**.

What they allow:

| Scope | Allows |
|---|---|
| `youtube.upload` | uploading videos |
| `youtube.force-ssl` | thumbnails, captions, playlists, rescheduling, and view counts |
| `yt-analytics.readonly` | reading watch time and retention for the Performance page |
| `drive.file` | Drive access **only to files Cutroom creates**; it can't see anything else in your Drive |
| `openid`, `userinfo.email` | showing which account is connected |

### 3.5 Add yourself as a test user

1. **Google Auth platform → Audience.**
2. Under **Test users**, click **Add users**.
3. Enter the Google account that owns your YouTube channel. If Drive should use a different account, add that one too.
4. Click **Save**.

### 3.6 Create the OAuth client

1. **Google Auth platform → Clients → Create client.**
2. Application type: **Web application**. Name: `Cutroom web`.
3. Under **Authorized redirect URIs**, click **Add URI** and enter:
   ```
   http://localhost:3000/api/google/callback
   ```
   You'll add the Vercel address in step 4.7.
4. Click **Create**.
5. Copy the **Client ID** and **Client secret** into your notes as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

   The secret is only shown in full once. If you lose it, open the client and add a new secret.

### 3.7 Publish the app (important)

While the app's status is **Testing**, Google expires your saved login after **7 days**, and automatic posting stops without warning.

1. **Google Auth platform → Audience.**
2. Under **Publishing status**, click **Publish app**, then **Confirm**.

You don't need Google's verification for personal use. When you connect your account, Google shows "Google hasn't verified this app". Click **Advanced → Go to Cutroom (unsafe)**. That screen appears because the app is yours and unreviewed, not because something is wrong.

Two more YouTube requirements:
- **Custom thumbnails:** your channel must be phone-verified. Do it at https://www.youtube.com/verify.
- **The channel itself:** it must exist before you connect. If you post as a Brand Account channel, pick that channel on Google's account chooser when connecting.

## 4. Vercel: the web app, database and storage

### 4.1 Import the repository

1. Go to https://vercel.com/new.
2. Under **Import Git Repository**, find `mikeminoza/Cutroom` and click **Import**. If it's missing, click **Adjust GitHub App Permissions** and give Vercel access to the repo.

### 4.2 Configure the project

On the **Configure Project** screen:

1. **Project name:** `cutroom`. This becomes `cutroom-….vercel.app`.
2. **Root Directory:** click **Edit**, choose `apps/web`, then **Continue**.
3. **Framework Preset:** should show **Next.js**. Leave **Build and Output Settings** as they are. Vercel finds `pnpm-lock.yaml` at the repository root and installs with pnpm.
4. Open **Environment Variables** and add these, one per row:

   | Key | Value |
   |---|---|
   | `GEMINI_API_KEY` | from step 2 |
   | `GEMINI_MODEL` | `gemini-3.8-flash` |
   | `GOOGLE_CLIENT_ID` | from step 3.6 |
   | `GOOGLE_CLIENT_SECRET` | from step 3.6 |
   | `WORKER_SECRET` | from step 1 |
   | `APP_PASSWORD` | from step 1 |
   | `CRON_SECRET` | from step 1 |

   Tip: you can paste all lines of a `.env`-style block into the first Key field at once.
5. Click **Deploy**.

The first deployment builds in a few minutes. Opening it right away will error, because there's no database yet. That's expected.

### 4.3 Add the database (Neon)

1. Open the project → **Storage** tab → **Create Database**. Under Marketplace providers choose **Neon** (Serverless Postgres), then **Continue**.
2. Accept the terms. Choose the **Free** plan and a region; **US East (N. Virginia)** sits next to Vercel's default function region. Name it `cutroom`, then **Create**.
3. When asked to connect it to a project, pick `cutroom` and keep **Development, Preview and Production** ticked. Click **Connect**.

This adds `DATABASE_URL` (plus a few other `PG…` variables Cutroom ignores). Tables are created automatically on the first request.

### 4.4 Add file storage (Blob)

1. **Storage** tab → **Create Database** → **Blob** → **Continue**.
2. Name it `cutroom-files`. Choose **Public** access. This can't be changed later, and Cutroom needs public: files get long unguessable URLs so the browser and worker can load them directly. Pick a region near the database.
3. Click **Create**, then connect it to the `cutroom` project for all environments.

### 4.5 Check the Blob token

1. Project → **Settings → Environment Variables**.
2. Look for `BLOB_READ_WRITE_TOKEN`.
3. If it's missing (newer stores sometimes connect only with `BLOB_STORE_ID`):
   - Open **Storage →** your Blob store, find the store's read-write token (shown in its quickstart / `.env.local` snippet), and copy it.
   - Back in **Settings → Environment Variables**, add `BLOB_READ_WRITE_TOKEN` with that value for all environments.
4. Either way, **copy the token into your notes**. Render needs it in step 5.

### 4.6 Find your production address

Project → **Overview**. Under **Domains** you'll see something like `cutroom-abc123.vercel.app`. In your notes, write it with `https://` in front and no trailing slash, for example `https://cutroom-abc123.vercel.app`. That's your **APP_URL**.

Add it to Vercel: **Settings → Environment Variables** → `APP_URL` = that address.

### 4.7 Tell Google about the address

1. Back in Google Cloud: **Google Auth platform → Clients** → open `Cutroom web`.
2. Under **Authorized redirect URIs**, click **Add URI** and enter your address plus `/api/google/callback`:
   ```
   https://cutroom-abc123.vercel.app/api/google/callback
   ```
3. Click **Save**. Google says changes can take a few minutes to apply.

### 4.8 Redeploy

Environment variable changes only apply to new deployments. Go to **Deployments**, click **⋯** on the top deployment, then **Redeploy** → **Redeploy**.

## 5. Render: the worker

### 5.1 Create it from the Blueprint

1. Go to https://dashboard.render.com and sign in with GitHub.
2. Click **New** → **Blueprint**.
3. Connect GitHub if asked, then pick `mikeminoza/Cutroom`. Render reads `render.yaml` from the repository and shows one service: **cutroom-worker** (Docker, Free).
4. Blueprint name: `cutroom`. Render asks for the values marked secret in the file. Fill in:

   | Key | Value |
   |---|---|
   | `APP_URL` | your Vercel address from 4.6, for example `https://cutroom-abc123.vercel.app` |
   | `WORKER_SECRET` | **the same value** you put in Vercel |
   | `GEMINI_API_KEY` | same as Vercel |
   | `GOOGLE_CLIENT_ID` | same as Vercel |
   | `GOOGLE_CLIENT_SECRET` | same as Vercel |
   | `BLOB_READ_WRITE_TOKEN` | the token from 4.5 |

   `GEMINI_MODEL` and `GEMINI_TTS_MODEL` are already set in the file. Render also asks for `ELEVENLABS_API_KEY`: leave it empty unless you use ElevenLabs voices (see [10](#10-optional-extras)).
5. Click **Apply** (or **Deploy Blueprint**).

Render only asks for these values on this first setup. To change them later, go to the service → **Environment**.

<details>
<summary>Prefer to create it by hand instead of using the Blueprint?</summary>

1. **New** → **Web Service** → pick the repository.
2. Settings:
   - Language: **Docker**
   - Branch: `main`
   - Dockerfile path: `./apps/worker/Dockerfile`
   - Docker build context: `.`
   - Instance type: **Free**
3. Under **Advanced**, set **Health Check Path** to `/health`.
4. Add the same six environment variables as in the table above, plus `GEMINI_MODEL=gemini-3.8-flash`.
5. Click **Create Web Service**.

</details>

### 5.2 Wait for the first build

The first Docker build installs ffmpeg and takes several minutes. Open the service → **Logs**. When it's done you'll see:

```
Cutroom worker listening on http://localhost:10000
```

The port number is assigned by Render. That's normal.

### 5.3 Check it's alive

At the top of the service page, copy its address, for example `https://cutroom-worker-xyz.onrender.com`. Open `<that address>/health` in your browser. You should see something like:

```json
{"ok":true,"active":null,"queued":[]}
```

## 6. Connect the two

1. Vercel → project → **Settings → Environment Variables** → add `WORKER_URL` = the Render address, with no trailing slash and no `/health`.
2. **Deployments → ⋯ → Redeploy**.

Your Vercel project should now have:

```
GEMINI_API_KEY        GEMINI_MODEL          GOOGLE_CLIENT_ID     GOOGLE_CLIENT_SECRET
WORKER_SECRET         WORKER_URL            APP_URL              APP_PASSWORD
CRON_SECRET           DATABASE_URL          BLOB_READ_WRITE_TOKEN
```

(plus Neon's and Blob's extra variables). Render should have:

```
APP_URL   WORKER_SECRET   GEMINI_API_KEY   GEMINI_MODEL   GEMINI_TTS_MODEL
GOOGLE_CLIENT_ID   GOOGLE_CLIENT_SECRET   BLOB_READ_WRITE_TOKEN   (ELEVENLABS_API_KEY)
```

Optional features add more later: the [checklist](#before-you-start-checklist) says which variables go where.

## 7. First login and connecting your channel

1. Open your Vercel address. Sign in with `APP_PASSWORD`.
2. Go to **Settings**. In **Connections**, every row should be ready:

   | Row | Should say |
   |---|---|
   | Gemini | Ready, using gemini-3.8-flash |
   | Worker | Online. If it says **Asleep**, the free worker is waking up; wait a minute and click **Check again**. |
   | Storage | Vercel Blob (not red) |
   | Database | Neon Postgres |
   | Sign-in | Password required |

3. Click **Connect YouTube**:
   - Pick the account (or Brand Account) that owns the channel.
   - On "Google hasn't verified this app", click **Advanced → Go to Cutroom (unsafe)**.
   - Tick all permissions and click **Continue**.

   You land back on Settings with "YouTube connected" and your channel name.
4. Click **Connect Drive** and do the same.
5. **Posting schedule:**
   - Pick your time zone, or use the **Use …** button for the one your browser reports.
   - Add the days and times you want to post.
6. **Defaults for new videos:** visibility, category, playlist, tags, description footer, and whether to approve before uploading.
7. Click **Save changes**.

## 8. Test run

Use a short test so you see the whole pipeline in a few minutes:

1. **Projects → New video**. Choose **Short**, write a one-line topic, then **Create project**.
2. **Script:** paste three or four sentences and click **Split into scenes**.
3. **Voice-over:** upload a recording of those sentences, then **Match scenes to voice-over**. Watch the two steps finish.
4. **Images:** copy each prompt, make the images, and drop them on their scenes. Any images work for a test.
5. **Preview:** press Play and check the motion and captions.
6. **Publish:**
   - Click **Write with AI**.
   - Choose **Pick a time**: 30 minutes from now, visibility **Unlisted**.
   - Keep **Let me approve**.
   - Click **Finish & schedule**.
   - You can close the tab: the worker keeps itself awake until the job is done.
7. When it says **Ready for your approval**, read the title and description, then click **Approve and upload**.
8. When it says **Scheduled**, open **YouTube Studio** from the buttons. The video is there as Scheduled. Open **Drive folder** to see the video, captions and project files.

## 9. Updating the app later

- **Code changes:** push to `main`. Vercel redeploys the web app and Render redeploys the worker automatically.
- **Database changes:** edit `apps/web/src/server/db/schema.ts`, then run:
  ```bash
  pnpm --filter @cutroom/web db:generate
  ```
  Commit the files it creates. The new migration runs on the first request after deploying.
- **Environment variables:**
  - Vercel: change, then **Redeploy**.
  - Render: change under **Environment**, then save and deploy.
- **Rotating `WORKER_SECRET`:** change it in **both** places, then redeploy both.

### Upgrading a deployment from before these features

If you deployed Cutroom before AI voice-overs, AI pictures, Performance, Shorts, series, ideas, multiple channels and notifications were added, do this once:

1. **Google Cloud:** turn on the **YouTube Analytics API** ([3.2](#32-turn-on-the-apis), item 4) and add the `yt-analytics.readonly` scope ([3.4](#34-add-the-scopes-the-permissions-cutroom-asks-for)). Without them everything works except watch time and retention.
2. **Vercel:** check that `CRON_SECRET` is set ([1](#1-prepare-three-secrets)). A password-protected app now refuses the daily check without it. Add the variables for any optional features you want (see the [checklist](#before-you-start-checklist)), on the worker too where the table says so.
3. **Deploy both:** push to `main`. Vercel and Render both redeploy; the web app and the worker must run the same version. On GitHub Actions, the worker always runs the latest `main`.
4. **Open the app once.** The first request updates the database:
   - Your YouTube connection becomes a channel in **Settings → Connections**, and the default one.
   - Videos already on YouTube stay tied to that channel, even if you later make another channel the default.
5. **Settings → Connections:** next to your channel, click **Reconnect** and allow the new permission, so **Performance** can show watch time.
6. **Settings:** pick a default voice under **AI voice**. If you set up notifications, choose the events under **Notifications** and click **Send a test**.

## 10. Optional extras

Each of these is off until you set it up. Change the variables, then redeploy (step 9).

### AI pictures and thumbnails

The Images step gets **Generate with AI** buttons, and the thumbnail ideas get **Generate**. Gemini paints each scene from its prompt with the characters' reference images attached.

Image models are **not** on Gemini's free tier. Turn on billing for the Google Cloud project of your Gemini key: open https://aistudio.google.com/apikey, click your key's project, and set up billing. The default model costs about $0.04 a picture. No extra variable is needed; `GEMINI_IMAGE_MODEL` picks another model ([ENVIRONMENT.md](ENVIRONMENT.md#gemini_image_model-and-gemini_image_size)).

### AI voice-overs

The Voice-over step can record the voice-over itself: an AI voice reads the narration, then the scenes are matched to it. Gemini voices work with your existing key on the free tier. For ElevenLabs voices, set `ELEVENLABS_API_KEY` on **Vercel and Render** ([ENVIRONMENT.md](ENVIRONMENT.md#elevenlabs_api_key-and-elevenlabs_model)). Pick the default voice in **Settings → AI voice**.

### Notifications

Get a message on Discord, Telegram or email when a video waits for approval, fails, or goes out. Set the `NOTIFY_…` variables (or `RESEND_API_KEY`) on **Vercel** as described in [ENVIRONMENT.md](ENVIRONMENT.md#notifications-notify_discord_webhook_url-notify_telegram_bot_token-notify_telegram_chat_id-resend_api_key-notify_email_to-notify_email_from), redeploy, then use **Settings → Connections → Notifications → Send a test**.

### Watch time on the Performance page

Views, likes and comments work for every connected channel. Watch time and retention also need the YouTube Analytics API (step 3.2) and its scope (step 3.4). A channel connected before you added them shows **Reconnect** in Settings; click it and allow access.

### More than one YouTube channel

**Settings → Connections → YouTube → Add a channel**, then pick the other account or Brand Account. The first channel is the default; **Make default** changes it. Each video posts to the default channel unless you pick another on its Publish step, and every channel gets its own posting slots.

## 11. Optional: the worker on GitHub Actions

Instead of the Render worker, GitHub Actions can run each job in its own run: several CPU cores (1080p renders in a fraction of the time), and nothing that falls asleep. Public repositories run free; private ones include 2,000 minutes a month on GitHub's free plan. Rendering a 5-minute video at 720p takes a few minutes.

1. **Create a token for Vercel to start runs.** GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → your Cutroom repository.
   - Permissions → Repository permissions → **Actions: Read and write**.
   - Generate it and copy it.
2. **Give the runs their secrets.** In the repository: **Settings → Secrets and variables → Actions → New repository secret**, one each:

   | Secret | Value |
   |---|---|
   | `APP_URL` | your Vercel address, as on Render |
   | `WORKER_SECRET` | the same value as on Vercel |
   | `GEMINI_API_KEY` | same as Vercel |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | same as Vercel |
   | `BLOB_READ_WRITE_TOKEN` | the token from 4.5 |
   | `ELEVENLABS_API_KEY` | only if you use ElevenLabs |

   Optional, under the **Variables** tab: `GEMINI_MODEL`, `GEMINI_TTS_MODEL`, `ELEVENLABS_MODEL`.
3. **Point Vercel at it.** Vercel → **Settings → Environment Variables**:
   - `GITHUB_DISPATCH_TOKEN` = the token from step 1
   - `GITHUB_REPO` = `owner/name`, for example `you/Cutroom`
   - Redeploy.
4. **Check it.** **Settings → Connections → Worker** says **GitHub Actions**. Start a test video; the repository's **Actions** tab shows a **Worker** run for it.

The Render worker is no longer used; you can suspend it. To switch back, remove `GITHUB_DISPATCH_TOKEN` (or set `WORKER_MODE=render`) and redeploy.

## 12. Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Vercel build fails with "Couldn't find any `pages` or `app` directory" | Root Directory not set | **Settings → Build and Deployment → Root Directory** = `apps/web`, then redeploy |
| App opens with an error page right after the first deploy | No database yet | Do steps 4.3–4.8 |
| Settings → Worker: **Not set up** | `WORKER_URL` or `WORKER_SECRET` missing on Vercel | Add them, redeploy |
| Worker shows **Asleep** | Free Render instances sleep after 15 idle minutes | Normal. Starting a job wakes it in about a minute |
| Job stuck on "Waiting for the worker" for minutes | Worker can't reach the web app, or secrets differ | Check Render **Logs**: "HTTP 401" means `WORKER_SECRET` differs; "fetch failed" or "404" means `APP_URL` on Render is wrong. Fix and redeploy |
| Job stops halfway and resumes later | The worker restarted (a deploy, or Render moving it) | Nothing to do: the next page visit or the daily cron resumes it from the last finished step. To be told, set up notifications ([10](#10-optional-extras)) |
| Google: **Error 400: redirect_uri_mismatch** | The callback address isn't registered | Add `<APP_URL>/api/google/callback` exactly (https, no trailing slash) in step 4.7, and make sure `APP_URL` on Vercel matches |
| Google: **Access blocked: app has not completed verification** | Your account isn't a test user and the app isn't published | Step 3.5, or publish the app (3.7) |
| "Google did not return a refresh token" | Google remembered an earlier approval | Remove Cutroom at https://myaccount.google.com/permissions, then connect again |
| "That Google account has no YouTube channel" | Wrong account picked | Connect again and choose the account or Brand Account that owns the channel |
| Posting stopped after about a week | The consent screen is still in **Testing** | Publish the app (3.7), then reconnect YouTube and Drive |
| Warning "Thumbnail not set … verified channel" | Channel not phone-verified | https://www.youtube.com/verify. The video itself was posted |
| Upload fails with `quotaExceeded` | YouTube's daily upload quota is used up | Wait until it resets (midnight Pacific time) and click **Retry** |
| "Gemini free-tier limit reached" | Too many AI requests in a minute | Wait a minute and try again |
| "This Gemini model is not on the free tier" | Picture generation needs billing | Turn on billing for the Gemini key's project ([10](#10-optional-extras)), or copy the prompts into another image tool |
| AI voice-over: "Add ELEVENLABS_API_KEY…" or no ElevenLabs voices | The key is missing on Vercel or Render, or lacks voices access | Set it on both, with text-to-speech and voices access, and redeploy |
| Performance shows views but "—" for watch time | YouTube Analytics API off, or the channel was connected without its scope | Steps 3.2 and 3.4, then **Reconnect** the channel in Settings |
| Job stays queued with "Could not start the GitHub Actions worker" | Wrong `GITHUB_REPO`, or the token lacks **Actions: Read and write** on that repository | Fix the variable or the token ([11](#11-optional-the-worker-on-github-actions)) and redeploy. The job starts on the next check |
| GitHub run fails right away with "WORKER_SECRET and APP_URL must be set" | Repository secrets missing | Add them under **Settings → Secrets and variables → Actions** |
| "Send a test" reports an error for Telegram | Wrong chat id, or you never messaged the bot | Message the bot first, then read the chat id again from `getUpdates` |
| Test email never arrives | Resend's test sender only sends to your own Resend account address | Use that address in `NOTIFY_EMAIL_TO`, or verify a domain in Resend and set `NOTIFY_EMAIL_FROM` |
| Gemini "model not found" | Google renamed or retired the model | Set `GEMINI_MODEL` to a current Flash model on both services |
| Settings → Storage is red | `BLOB_READ_WRITE_TOKEN` missing on Vercel | Step 4.5 |
| Image or voice-over upload fails in production | Blob store created as **Private**, or token missing | Create a new **Public** store, connect it, update the token on Vercel and Render |
| Worker log: "Could not reach the web app to resume jobs" on start | Web app address wrong or protected | Check `APP_URL` on Render. Vercel → **Settings → Deployment Protection**: production must not require Vercel login |
| `/api/cron` answers "Set CRON_SECRET to enable the daily check" | `APP_PASSWORD` is set but `CRON_SECRET` isn't | Add `CRON_SECRET` on Vercel ([1](#1-prepare-three-secrets)) and redeploy |
| "This video's YouTube channel was disconnected" | The video is tied to a channel you disconnected. It waits rather than going out on another channel | Reconnect that channel in **Settings**, then **Approve** or **Retry**. Or pick another channel on the Publish step |
| "This video was archived to Drive, so its files are gone" | Its working files were moved to Drive after posting | Make the Short or series from a video that isn't archived |
| "… could not be copied. Upload it again, or remove it" | A picture or the music of the source video is missing from storage | Upload that file again on the source video, or remove it, then try again |
| "Another job is already running for this video" | A voice-over, matching or publishing job is still active | Wait for it to finish, or stop it, then try again |
| Render: very slow renders | The free instance has a fraction of one CPU | Keep 720p. For long videos render 1080p only when needed |
