# Production image for the Delta Shipping web app (Next.js).
# Build from the repo root:  docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_API_URL is baked into the JS bundle at build time.
FROM node:20-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter web

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter web run build

# ---- runtime ----
FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY --from=builder /repo/apps/web/.next ./apps/web/.next
COPY --from=builder /repo/apps/web/public ./apps/web/public
RUN pnpm install --frozen-lockfile --prod --filter web

WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
