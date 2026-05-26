# Delta Shipping

Monorepo: **Next.js** (App Router) + **NestJS** API + **PostgreSQL** + **Prisma** + **pnpm workspaces**, aligned with `schema-v1.sql` and the design docs in this folder.

**v1 choices:** email/password auth (JWT), API on port **3001**, web on **3000**.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker (optional, for local Postgres + Redis used by Excel import queue)

## Troubleshooting: `pnpm db:up` cannot pull Postgres (Docker Hub / DNS)

If you see **`lookup registry-1.docker.io ... server misbehaving`** or **`dial tcp ... registry-1.docker.io:443`**, the machine running Docker cannot resolve or reach Docker Hub. That is a **host network/DNS** issue, not this repo.

Try in order:

1. **Fix system DNS** (often resolves `127.0.0.53: server misbehaving` from systemd-resolved): set reliable nameservers in your OS network settings (e.g. **8.8.8.8** and **1.1.1.1**). On Ubuntu: **Settings → Network →** your connection **→ IPv4 → DNS**.

   Quick check: `getent hosts registry-1.docker.io` should print IP addresses before `pnpm db:up` will work.

2. **Point the Docker daemon at explicit DNS** (Linux): merge or create `/etc/docker/daemon.json` using `docker/daemon.json.example` in this repo as a starting point, then `sudo systemctl restart docker`. Retry `pnpm db:up`.

3. **Corporate firewall / proxy**: configure Docker for **HTTPS_PROXY** / **HTTP_PROXY** (Docker Desktop **Settings → Resources → Proxies**, or `/etc/systemd/system/docker.service.d/http-proxy.conf` on Linux).

4. **Work offline after one successful pull**: when you have a working network once, run `docker pull postgres:16-alpine`; later `pnpm db:up` uses the local image without needing registry access. If DNS remains broken but the image is already present, run `SKIP_REGISTRY_DNS_CHECK=1 pnpm db:up`.

If Docker Hub stays unreachable, install PostgreSQL locally, apply `schema-v1.sql`, and set `DATABASE_URL` in `apps/api/.env` (see Quick start).

## Quick start

1. **Start PostgreSQL and Redis** (Docker):

   ```bash
   pnpm db:up
   ```

   On first start, `schema-v1.sql` is loaded automatically into `delta_shipping`. Redis listens on **6379** for Bull (Excel import jobs). PostgreSQL is published on host port **5433** (to avoid clashing with another Postgres on **5432**); `apps/api/.env.example` uses `localhost:5433` in `DATABASE_URL`.

   If Docker is not available, install PostgreSQL locally and run `schema-v1.sql` manually, then set `DATABASE_URL` accordingly. Run Redis locally or set `REDIS_HOST` / `REDIS_PORT` in `apps/api/.env`.

   **Existing databases:** if you already have the DB from an older `schema-v1.sql`, apply additive DDL under `migrations/sql/` (e.g. `002_delivery_notes_po_fields.sql`) before relying on new columns.

2. **API environment**

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

3. **Generate Prisma client & seed dev users** (optional)

   ```bash
   cd apps/api && pnpm prisma:generate && pnpm prisma:seed
   ```

   Default admin (from `.env.example`): `admin@example.com` / `ChangeMeAdmin123!` — change immediately.

   Multi-role test user (PICKER + PACKER + SHIPPER, for post-login role choice): `user@example.com` / `ChangeMeUser123!` — configurable via `SEED_MULTI_ROLE_USER_*` in `apps/api/.env`.

4. **Web environment**

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

5. **Run dev servers**

   From repo root:

   ```bash
   pnpm dev:api
   ```

   In another terminal:

   ```bash
   pnpm dev:web
   ```

   - Web: [http://localhost:3000](http://localhost:3000)
   - API: [http://localhost:3001](http://localhost:3001) — try `GET /health`

## Auth (v1)

- `POST /auth/register` — email/password; optional `roleCodes` (default `PICKER`).
- `POST /auth/login` — email/password; JWT active role defaults by priority (`SUPERVISOR` → `SYSTEM` → operational roles). No role field on the request.
- `GET /auth/me` — Bearer JWT; returns user, active role, permission codes for that role.
- `POST /auth/active-role` — body `{ "roleCode": "..." }`; switch active role (new JWT). The web app uses this after login when a user has multiple operational roles only.

## Delivery notes (read)

- `GET /delivery-notes` — Bearer JWT; requires permission **`dn.read`** for the **active** role (seeded for `SUPERVISOR`, `PICKER`, `PACKER`, `SHIPPER` when you run `pnpm prisma:seed` in `apps/api`).
- Query: `is_open` (`true`/`false`, default **open only** if omitted), `status` (enum), `page` (>=1, default 1), `pageSize` (1–200, default 50). `limit` is still accepted as a fallback alias for page size.
- Response: `{ items, page, pageSize, total, totalPages }`.

If your database was created before this permission existed, run `pnpm prisma:seed` again to insert `dn.read` and link it to roles.

## Delivery notes (workflow & import)

Re-run **`pnpm prisma:seed`** in `apps/api` after pulling these changes so **`dn.status.supervise`** and role wiring match the transition matrix.

- `GET /delivery-notes/:id` — detail, lines, status/priority history, **`allowedNextStatuses`**, **`canSetPriority`** (requires `dn.read`).
- `POST /delivery-notes/:id/transition` — body `{ "toStatus": "<dn_status>", "message"?: "..." }`. Enforces **role + permission** per `steps-2-to-5-spec-v1.md` §2.2–2.3; writes **`dn_status_history`**; sets **`is_open`** when moving to `SHIPPED` or `CANCELLED`.
- `PATCH /delivery-notes/:id/priority` — body `{ "toPriorityNo": <int>=1, "reason": "..." }`. Supervisor + **`dn.priority.set`**; writes **`dn_priority_history`**.
- `POST /import/excel` — multipart field **`file`** (`.xlsx` / `.xlsm` / `.xls`), max **15 MB**. Queues an **async** job (Bull + Redis); returns `{ batchId, status: "queued" }`. First sheet only; **one row = one line**; group by **`DN#`**. Requires **`import.daily_dn`** and an **active role** of **`SUPERVISOR`** or **`SYSTEM`** only. Poll **`GET /import/batches/:id`** (same rules). If queuing fails with **503**, start **Redis** (`pnpm db:up` includes it) and check **`REDIS_*`** in `apps/api/.env`. **Sign-in** defaults the active role to **SUPERVISOR** when that role is assigned. Delivery notes get **`po_date`**, **`customer_po`**, **`ship_to_region_state`** from the sheet when present. Each import **upserts** **`customers`** (by **`Sold-to`** code) and **`ship_to_locations`** (by **customer + `Ship-to`** code), sets **`customer_id`** / **`ship_to_location_id`** on the DN. Optional header columns for richer master data include **`Sold-to Name`** / **`Customer Name`**, **`Ship-to Name`**, and address fields such as **`Ship-to Street`**, **`City`**, **`Ship-to State`**, **`Postal Code`**, **`Country`** (see `ExcelIngestService` for aliases).
- **`GET /import/batches`** — list recent import batches (optional query **`limit`**, 1–100, default 50), **`started_at`** descending, includes **`_count.delivery_notes`** per batch. Same auth as **`POST /import/excel`**.
- **`DELETE /import/batches/:id`** — **Undo one import** (same auth as Excel upload). Deletes every **`delivery_notes`** row whose **`last_seen_import_batch_id`** is this batch (lines, status/priority history, and shipments cascade). Then deletes the **`import_batches`** row (import errors cascade). **Not allowed** while batch **`RUNNING`**. Does **not** remove **`customers`** / **`ship_to_locations`**. DNs later touched by another import have a newer **`last_seen_import_batch_id`**, so they are **not** removed when undoing an older batch.
- **CLI** (from `apps/api`, with **`DATABASE_URL`** loaded): `pnpm import:undo -- <import-batch-uuid>` — same DB effect as **`DELETE /import/batches/:id`** (no JWT; use only on trusted hosts).

## Project layout

| Path | Description |
|------|-------------|
| `apps/web` | Next.js 15 (App Router) |
| `apps/api` | NestJS API, Prisma |
| `schema-v1.sql` | Canonical PostgreSQL DDL |
| `apps/api/prisma/schema.prisma` | Prisma schema (matches SQL tables) |
| `database-design-document-v1.md` | Field-level DB spec |

## CI/CD

GitHub Actions run **lint**, **unit tests**, **build**, and **Postgres migration checks** on every PR and push to `main`. Successful merges can trigger a **deploy** workflow that uploads build artifacts (configure production SSH/cloud deploy in `.github/workflows/deploy.yml`).

See [docs/ci-cd.md](docs/ci-cd.md) for setup, environment variables, and enabling real production deploy.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `pnpm lint:ci` | ESLint (no auto-fix) for API and web |
| `pnpm test:ci` | API unit tests (Jest) |
| `pnpm build:ci` | Production build for API and web |
| `pnpm db:check-dns` | Verify `registry-1.docker.io` resolves (before `db:up`) |
| `pnpm db:up` | Start Postgres container |
| `pnpm db:down` | Stop containers |
| `pnpm db:reset` | Remove volume & recreate DB |
| `pnpm dev:api` | Nest watch mode |
| `pnpm dev:web` | Next.js dev |
