import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Monorepo root (`delta-shipping`); stops Next from picking a lockfile outside the repo and stabilizes Turbopack. */
const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
