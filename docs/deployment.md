# Deploying Delta Shipping to a cloud server

## 1. Provision the server

Any provider works (DigitalOcean, Hetzner, AWS, GCP, Azure...). Minimum spec:

- **OS:** Ubuntu 24.04 LTS
- **Size:** 2 vCPU / 4 GB RAM / 40 GB disk (comfortable for API + web + Postgres + Redis)
- **Firewall / security group:** allow inbound **22** (SSH), **3000** (web), **3001** (API).
  Lock 22 to your IP if the provider allows it. Postgres (5432) and Redis (6379)
  are *not* published — only the containers talk to them.

No domain name is required to start: the team opens `http://<server-ip>:3000`.
A domain + HTTPS (nginx + Let's Encrypt) is the recommended follow-up; the
`NEXT_PUBLIC_API_URL` / `CORS_ORIGIN` values below just need to match whatever
the browser URL becomes, and the web image is rebuilt when they change.

## 2. Prepare the server (one time)

```bash
# Docker
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER   # log out and back in afterwards

# Code — clone the repo (or copy it over with scp) and check out the release
git clone <repo-url> /opt/delta-shipping
cd /opt/delta-shipping

# Secrets — never commit this file
cp .env.prod.example .env
nano .env   # set POSTGRES_PASSWORD, JWT_SECRET, YOUR_SERVER_IP, admin email/password
```

Generate the JWT secret with: `openssl rand -base64 48`

## 3. Deploy

```bash
cd /opt/delta-shipping
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api   # watch the first start
```

What happens on start:

1. `postgres` initializes a fresh database from `schema-v1.sql`.
2. `api` waits for Postgres, marks the two pre-existing Prisma migrations as
   applied, runs `prisma migrate deploy` for the rest, optionally seeds the
   admin user (`RUN_SEED_ON_BOOT=1`), then starts on port 3001.
3. `web` serves the Next.js app on port 3000.

Open `http://<server-ip>:3000` and log in with the seeded admin. **Change the
admin password immediately**, then set `RUN_SEED_ON_BOOT=0` in `.env` so later
restarts don't re-run the seed.

## 4. Redeploying after an update

```bash
cd /opt/delta-shipping
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically on API start. Postgres/Redis data lives in Docker
volumes and survives rebuilds. Back up with e.g.:

```bash
docker exec delta-shipping-postgres pg_dump -U delta delta_shipping > backup-$(date +%F).sql
```

## 5. Useful commands

```bash
# status / logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web

# restart just the app after a .env change
docker compose -f docker-compose.prod.yml up -d --build api web
```

## Notes / future improvements

- The GitHub `Deploy` workflow (`.github/workflows/deploy.yml`) currently only
  builds downloadable artifacts; its SSH-to-server job is still commented out.
  Once this server is stable, that job can be wired up with `DEPLOY_HOST` /
  `DEPLOY_USER` / `DEPLOY_SSH_KEY` secrets for push-button deploys.
- For HTTPS: put nginx (or Caddy) in front of ports 3000/3001 with Let's Encrypt
  certificates, then rebuild the web image with
  `WEB_API_URL=https://api.yourdomain.com` and set
  `CORS_ORIGIN=https://yourdomain.com`.
