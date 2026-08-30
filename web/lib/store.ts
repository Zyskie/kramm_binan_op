// Persistence layer, backed by Upstash Redis (Vercel Marketplace integration).
// Replaces the old docs/data/*.json files committed to git -- there is no
// persistent disk on Vercel serverless functions.
//
// Set up: Vercel dashboard -> Storage -> Marketplace Database Providers ->
// Upstash -> Redis. It injects KV_REST_API_URL / KV_REST_API_TOKEN
// (or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, both are accepted
// below) into the project's env vars automatically.

import { Redis } from "@upstash/redis";

let cached: Redis | null = null;

// Lazy: reading env vars and constructing the client happens on first real
// use, not at module-import time, so `next build`'s page-data collection
// (which imports every route) doesn't fail before env vars are configured.
function getRedis(): Redis {
  if (cached) return cached;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing Redis credentials. Add the Upstash Redis integration to this Vercel project " +
        "(Storage -> Marketplace Database Providers -> Upstash)."
    );
  }
  cached = new Redis({ url, token });
  return cached;
}

const KEYS = {
  positions: "kramm:positions",
  trades: "kramm:trades",
  history: "kramm:history",
  latest: "kramm:latest",
} as const;

export async function loadPositions<T>(): Promise<T> {
  return ((await getRedis().get(KEYS.positions)) as T) ?? ({} as T);
}

export async function loadTrades<T>(): Promise<T[]> {
  return ((await getRedis().get(KEYS.trades)) as T[]) ?? [];
}

export async function loadHistory<T>(): Promise<T[]> {
  return ((await getRedis().get(KEYS.history)) as T[]) ?? [];
}

export async function loadLatest<T>(): Promise<T | null> {
  return ((await getRedis().get(KEYS.latest)) as T) ?? null;
}

export async function saveAll(data: {
  positions: unknown;
  trades: unknown;
  history: unknown;
  latest: unknown;
}): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.set(KEYS.positions, data.positions),
    redis.set(KEYS.trades, data.trades),
    redis.set(KEYS.history, data.history),
    redis.set(KEYS.latest, data.latest),
  ]);
}
