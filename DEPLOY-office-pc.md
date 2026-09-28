# Deploying Delta Shipping on the office PC (CASURPC5896)

Runs the full site (web + API + database) in Docker inside WSL2/Ubuntu.
Teammates open it in their browsers at `http://CASURPC5896:3000`.
No Docker Desktop subscription needed — this uses the free Docker Engine.

Time needed: about 30–60 minutes (mostly downloads).

---

## 0. Prerequisites (one time)

- WSL2 with Ubuntu installed and a Linux account created. (Done if
  `wsl --list --verbose` shows Ubuntu under VERSION 2.)
- Administrator rights on the PC (for Docker install + firewall rule).

## 1. Let teammates reach the PC (mirrored networking)

By default WSL2 hides behind the Windows PC, so other computers can't
reach it. Fix that once:

1. In Windows, open Notepad **as Administrator** and open (or create)
   `C:\Users\<your-windows-username>\.wslconfig`. If the file doesn't
   exist, create it.
2. Put exactly this in it:
   ```
   [wsl2]
   networkingMode=mirrored
   ```
3. Save, then in PowerShell run `wsl --shutdown`. The next time Ubuntu
   starts it shares the PC's network, so `CASURPC5896` reaches Docker.

## 2. Install Docker Engine inside Ubuntu

In the Ubuntu window, run these (copy-paste the whole block):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
sudo service docker start
```

Close the Ubuntu window and open it again, then verify:

```bash
docker run --rm hello-world
```

You should see "Hello from Docker!". (If a download step fails, the
office network may be blocking it — ask IT to allow
`download.docker.com`.)

## 3. Copy this package into Ubuntu

Unzip this package somewhere easy in Windows, e.g.
`C:\delta-shipping-deploy\`. From Ubuntu it's visible at
`/mnt/c/delta-shipping-deploy/`. Copy it into your Linux home
(Docker builds are much faster there than on /mnt/c):

```bash
cp -r /mnt/c/delta-shipping-deploy ~/delta-shipping
cd ~/delta-shipping
```

## 4. Configure

```bash
cp .env.prod.example .env
nano .env
```

Fill in (use letters/digits only for the passwords — no `@ : / ? # & = +`):

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | pick a long random password |
| `JWT_SECRET` | long random string (`openssl rand -base64 48` can generate one) |
| `CORS_ORIGIN` | `http://CASURPC5896:3000` |
| `WEB_API_URL` | `http://CASURPC5896:3001` |
| `RUN_SEED_ON_BOOT` | `1` (first start only — creates the admin user and the product table data) |
| `SEED_ADMIN_EMAIL` | your work email |
| `SEED_ADMIN_PASSWORD` | pick a strong password |

Save in nano with `Ctrl+O`, `Enter`, then `Ctrl+X`.

## 5. Start it

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes ~10 minutes (it compiles the API and web app).
Watch progress with:

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

When the API log shows it is listening (and the seed line
`[seed] products: ensured ... product rows`), it's up.

**Then turn the seed off** so a restart doesn't re-run it:

```bash
nano .env   # set RUN_SEED_ON_BOOT=0, save
```

## 6. Open the Windows firewall

Teammates' browsers talk to the web app (port 3000) **and** the API
(port 3001) directly, so both need an inbound rule. In an
Administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Delta Shipping web" `
  -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
New-NetFirewallRule -DisplayName "Delta Shipping API" `
  -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow
```

## 7. Use it

- On the PC itself or any teammate's browser: `http://CASURPC5896:3000`
- Log in with the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` you set.
- The daily Excel import and manual delivery-note creation are under
  their usual menu items.

## Everyday commands (run from `~/delta-shipping` in Ubuntu)

```bash
# status / follow logs
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f

# restart everything (e.g. after the PC reboots)
docker compose -f docker-compose.prod.yml up -d

# stop everything
docker compose -f docker-compose.prod.yml down
```

Note: after the PC reboots, Ubuntu/WSL2 doesn't auto-start. Either open
the Ubuntu app once (Docker containers are set to restart
automatically), or ask IT about starting WSL2 on boot if you want it
fully hands-free.

## Updating later

I'll send a new package when there are updates. To apply:

```bash
cd ~/delta-shipping
# back up the database first:
docker exec delta-shipping-postgres pg_dump -U delta delta_shipping > backup-$(date +%F).sql
# then replace the files with the new package (keep your .env!)
docker compose -f docker-compose.prod.yml up -d --build
```

Database migrations run automatically on container start.
