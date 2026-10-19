# Cutroom worker: Node + ffmpeg. Build from the repository root:
#   docker build -f apps/worker/Dockerfile .
FROM node:24-bookworm-slim

# ffmpeg with libass for captions; Liberation fonts stand in for Arial.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-liberation fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache -f

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --prod --filter @cutroom/worker...

COPY packages/shared packages/shared
COPY apps/worker apps/worker

ENV NODE_ENV=production
WORKDIR /app/apps/worker
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/index.ts"]
