#!/usr/bin/env bash
# Fail fast if this host cannot resolve Docker Hub (common cause of `pnpm db:up` image pull errors).
set -euo pipefail
if [ "${SKIP_REGISTRY_DNS_CHECK:-}" = 1 ]; then
  echo "SKIP_REGISTRY_DNS_CHECK=1: skipping registry-1.docker.io lookup."
  exit 0
fi
if ! getent hosts registry-1.docker.io >/dev/null 2>&1; then
  echo "DNS lookup for registry-1.docker.io failed."
  echo "Fix system DNS or Docker daemon DNS — see README section \"Troubleshooting: pnpm db:up\"."
  echo "Example: copy docker/daemon.json.example to /etc/docker/daemon.json and restart Docker."
  exit 1
fi
echo "OK: registry-1.docker.io resolves ($(getent hosts registry-1.docker.io | head -1 | awk '{print $1}'))"
