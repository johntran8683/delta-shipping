# CI/CD

GitHub Actions workflows in [`.github/workflows/`](../.github/workflows/).

## CI (`ci.yml`)

Runs on every **push** and **pull request** to `main`.

| Job | What it does |
|-----|----------------|
| **lint-test-build** | `pnpm install --frozen-lockfile`, `pnpm lint:ci`, `pnpm test:ci`, `pnpm build:ci` |
| **database-migrations** | Starts Postgres 16, applies `schema-v1.sql`, runs `scripts/prisma-baseline-and-deploy.sh` |

### Local equivalents

```bash
pnpm install --frozen-lockfile
pnpm lint:ci
pnpm test:ci
NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm build:ci
```

## Deploy (`deploy.yml`)

Runs when:

1. **CI** completes successfully on `main`, or
2. You trigger **Run workflow** manually (`workflow_dispatch`).

The workflow file is heavily commented — read [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) alongside this section.

### How CI and Deploy connect

```text
  push/merge to main
         │
         ▼
    ┌─────────┐
    │   CI    │  lint, test, build, DB migrations
    └────┬────┘
         │ workflow_run (completed)
         ▼
    ┌─────────┐
    │  gate   │  skip if CI failed or not on main
    └────┬────┘
         │
         ▼
    ┌─────────────────┐
    │ build-artifacts │  production build → upload artifacts
    └─────────────────┘
```

- **`workflow_run`** starts Deploy when CI *finishes* (even on failure). The **gate** job’s `if:` condition prevents building when CI failed.
- **Checkout** uses `workflow_run.head_sha` so the deployed commit is the one CI tested, not an arbitrary tip of `main`.

### What it does today

- Builds API and web with `NEXT_PUBLIC_API_URL` from the GitHub Environment variable (fallback: `https://api.example.com`).
- Uploads **artifacts** (`api-dist-*`, `web-next-*`) for 30 days — download from the Actions run page.

### Wire up real production deploy

1. In GitHub: **Settings → Environments → production** (create if missing).
2. Add **Variables**:
   - `NEXT_PUBLIC_API_URL` — public API URL used at web build time (e.g. `https://api.yourdomain.com`).
3. Add **Secrets** when you enable SSH/cloud deploy (examples):
   - `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
4. Uncomment the `deploy-to-server` job in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) and adapt paths/commands for your server.

On the server after each deploy:

```bash
cd apps/api && pnpm prisma:migrate
pnpm start:prod   # API
cd apps/web && pnpm start   # web (behind nginx)
```

Ensure Postgres, Redis, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, and `REDIS_*` are set on the host (not in the repo).

## Branch protection (recommended)

On `main`:

- Require status checks: **Lint, test, and build**, **Validate DB schema and migrations**
- Require PR reviews before merge
