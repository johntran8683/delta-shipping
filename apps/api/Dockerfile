# Production image for the Delta Shipping API (NestJS).
# Build from the repo root:  docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Install workspace deps for the api package only (dev deps included:
# the prisma CLI is needed at container start for migrations).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
RUN pnpm install --frozen-lockfile --filter api

# Build the API (prisma generate runs via the package postinstall).
COPY apps/api ./apps/api
COPY scripts/prisma-baseline-and-deploy.sh ./scripts/prisma-baseline-and-deploy.sh
RUN pnpm --filter api run build

WORKDIR /repo/apps/api
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
