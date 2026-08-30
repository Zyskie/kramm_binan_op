// Thin client for Bybit v5 public market-data endpoints, USD-M perpetuals
// (category=linear). No API key needed -- all data used is public.
//
// This function must run from a non-US Vercel region (see vercel.json /
// preferredRegion in the route handler) -- Bybit and Binance both return
// HTTP 403/451 to US datacenter IPs.

const BASE = "https://api.bybit.com";

const INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "1d": "D",
};

const INTERVAL_MS: Record<string, number> = {
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export type Candle = {
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  close_time: number;
};

async function bybitGet(path: string, params: Record<string, string | number>) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  const data = await res.json();
  if (data.retCode !== 0) {
    throw new Error(`Bybit API error ${data.retCode}: ${data.retMsg} (${path})`);
  }
  return data.result;
}

export async function getKlines(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
  const step = INTERVAL_MS[interval] ?? 3_600_000;
  const result = await bybitGet("/v5/market/kline", {
    category: "linear",
    symbol,
    interval: INTERVAL_MAP[interval] ?? interval,
    limit: Math.min(limit, 1000),
  });
  const rows: string[][] = [...(result.list ?? [])].reverse();
  return rows.map((r) => ({
    open_time: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    close_time: Number(r[0]) + step - 1,
  }));
}

export async function getFundingRate(symbol: string): Promise<number> {
  const result = await bybitGet("/v5/market/funding/history", {
    category: "linear",
    symbol,
    limit: 1,
  });
  const rows = result.list ?? [];
  return rows.length ? Number(rows[0].fundingRate) : 0.0;
}

export type OpenInterestPoint = { timestamp: number; sumOpenInterest: number };

export async function getOpenInterestHist(
  symbol: string,
  period = "1h",
  limit = 30
): Promise<OpenInterestPoint[]> {
  const result = await bybitGet("/v5/market/open-interest", {
    category: "linear",
    symbol,
    intervalTime: period,
    limit: Math.max(limit, 48),
  });
  const rows: { timestamp: string; openInterest: string }[] = [...(result.list ?? [])].reverse();
  return rows.map((r) => ({ timestamp: Number(r.timestamp), sumOpenInterest: Number(r.openInterest) }));
}
