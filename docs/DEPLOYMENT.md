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

1. [Prepare three secrets](#1-prepare-three-secrets)
2. [Gemini API key](#2-gemini-api-key)
3. [Google Cloud: YouTube and Drive sign-in](#3-google-cloud-youtube-and-drive-sign-in)
4. [Vercel: the web app, database and storage](#4-vercel-the-web-app-database-and-storage)
5. [Render: the worker](#5-render-the-worker)
6. [Connect the two](#6-connect-the-two)
7. [First login and connecting your channel](#7-first-login-and-connecting-your-channel)
8. [Test run](#8-test-run)
9. [Updating the app later](#9-updating-the-app-later)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prepare three secrets

Open a notes file (or your password manager) and create three values. You'll paste them into Vercel and Render.

| Name | How to make it |
|---|---|
| `WORKER_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CRON_SECRET` | the same command again, for a different value |
| `APP_PASSWORD` | a password you'll type to log in |

No Node installed? Any password generator works. Use 40 or more random letters and numbers.

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

### 3.2 Turn on the two APIs

1. Menu ☰ → **APIs & Services → Library**.
2. Search **YouTube Data API v3**, open it, and click **Enable**.
3. Go back to the Library, search **Google Drive API**, open it, and click **Enable**.

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
2. Scroll to **Manually add scopes**, paste these five lines, then click **Add to table**:
   ```
   https://www.googleapis.com/auth/youtube.upload
   https://www.googleapis.com/auth/youtube.force-ssl
   https://www.googleapis.com/auth/drive.file
   openid
   https://www.googleapis.com/auth/userinfo.email
   ```
3. Click **Update**, then **Save**.

What they allow:

| Scope | Allows |
|---|---|
| `youtube.upload` | uploading videos |
| `youtube.force-ssl` | thumbnails, captions, playlists and rescheduling |
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

   `GEMINI_MODEL` is already set in the file.
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
APP_URL   WORKER_SECRET   GEMINI_API_KEY   GEMINI_MODEL
GOOGLE_CLIENT_ID   GOOGLE_CLIENT_SECRET   BLOB_READ_WRITE_TOKEN
```

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
   - **Keep the tab open.** The free worker stays awake while the page checks on it.
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

## 10. Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| Vercel build fails with "Couldn't find any `pages` or `app` directory" | Root Directory not set | **Settings → Build and Deployment → Root Directory** = `apps/web`, then redeploy |
| App opens with an error page right after the first deploy | No database yet | Do steps 4.3–4.8 |
| Settings → Worker: **Not set up** | `WORKER_URL` or `WORKER_SECRET` missing on Vercel | Add them, redeploy |
| Worker shows **Asleep** | Free Render instances sleep after 15 idle minutes | Normal. Starting a job wakes it in about a minute |
| Job stuck on "Waiting for the worker" for minutes | Worker can't reach the web app, or secrets differ | Check Render **Logs**: "HTTP 401" means `WORKER_SECRET` differs; "fetch failed" or "404" means `APP_URL` on Render is wrong. Fix and redeploy |
| Job stops halfway and resumes later | The tab was closed and the free worker fell asleep | Keep a Cutroom tab open during uploads. The daily cron and the next page visit resume it from the last finished step |
| Google: **Error 400: redirect_uri_mismatch** | The callback address isn't registered | Add `<APP_URL>/api/google/callback` exactly (https, no trailing slash) in step 4.7, and make sure `APP_URL` on Vercel matches |
| Google: **Access blocked: app has not completed verification** | Your account isn't a test user and the app isn't published | Step 3.5, or publish the app (3.7) |
| "Google did not return a refresh token" | Google remembered an earlier approval | Remove Cutroom at https://myaccount.google.com/permissions, then connect again |
| "That Google account has no YouTube channel" | Wrong account picked | Connect again and choose the account or Brand Account that owns the channel |
| Posting stopped after about a week | The consent screen is still in **Testing** | Publish the app (3.7), then reconnect YouTube and Drive |
| Warning "Thumbnail not set … verified channel" | Channel not phone-verified | https://www.youtube.com/verify. The video itself was posted |
| Upload fails with `quotaExceeded` | YouTube's daily upload quota is used up | Wait until it resets (midnight Pacific time) and click **Retry** |
| "Gemini free-tier limit reached" | Too many AI requests in a minute | Wait a minute and try again |
| Gemini "model not found" | Google renamed or retired the model | Set `GEMINI_MODEL` to a current Flash model on both services |
| Settings → Storage is red | `BLOB_READ_WRITE_TOKEN` missing on Vercel | Step 4.5 |
| Image or voice-over upload fails in production | Blob store created as **Private**, or token missing | Create a new **Public** store, connect it, update the token on Vercel and Render |
| Worker log: "Could not reach the web app to resume jobs" on start | Web app address wrong or protected | Check `APP_URL` on Render. Vercel → **Settings → Deployment Protection**: production must not require Vercel login |
| Render: very slow renders | The free instance has a fraction of one CPU | Keep 720p. For long videos render 1080p only when needed |
