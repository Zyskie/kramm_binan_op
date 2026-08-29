"""Thin client for Bybit v5 public market-data endpoints, USD-M perpetuals
(category=linear). No API key needed -- all data used is public.

Why Bybit and not Binance: Binance's public futures API (fapi.binance.com)
returns HTTP 451 to datacenter IPs, so the hourly cloud job can't reach it.
Bybit's public market data has no such geo-block. Prices and indicators for
the BTC/ETH/BNB perpetuals track Binance closely.

Return shapes match what evaluate.py expects: klines oldest-first, open
interest history oldest-first, funding rate as a plain float.
"""

import json
import urllib.request

BASE = "https://api.bybit.com"

# Binance-style interval string -> Bybit kline `interval` param.
_INTERVAL_MAP = {"1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "1d": "D"}
# Interval length in milliseconds, to synthesize a candle close_time.
_INTERVAL_MS = {"1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000}


def _get(path, params=None):
    url = BASE + path
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    if data.get("retCode") != 0:
        raise RuntimeError(f"Bybit API error {data.get('retCode')}: {data.get('retMsg')} ({path})")
    return data["result"]


def get_klines(symbol, interval, limit=500):
    step = _INTERVAL_MS.get(interval, 3_600_000)
    result = _get(
        "/v5/market/kline",
        {
            "category": "linear",
            "symbol": symbol,
            "interval": _INTERVAL_MAP.get(interval, interval),
            "limit": min(limit, 1000),
        },
    )
    # Bybit returns newest-first; evaluate.py works oldest-first.
    rows = list(reversed(result.get("list", [])))
    return [
        {
            "open_time": int(r[0]),
            "open": float(r[1]),
            "high": float(r[2]),
            "low": float(r[3]),
            "close": float(r[4]),
            "volume": float(r[5]),
            "close_time": int(r[0]) + step - 1,
        }
        for r in rows
    ]


def get_last_price(symbol):
    result = _get("/v5/market/tickers", {"category": "linear", "symbol": symbol})
    return float(result["list"][0]["lastPrice"])


def get_funding_rate(symbol):
    result = _get(
        "/v5/market/funding/history",
        {"category": "linear", "symbol": symbol, "limit": 1},
    )
    rows = result.get("list", [])
    return float(rows[0]["fundingRate"]) if rows else 0.0


def get_open_interest_hist(symbol, period="1h", limit=30):
    result = _get(
        "/v5/market/open-interest",
        {"category": "linear", "symbol": symbol, "intervalTime": period, "limit": max(limit, 48)},
    )
    # Bybit returns newest-first; return oldest-first to match evaluate.py.
    rows = list(reversed(result.get("list", [])))
    return [
        {"timestamp": int(r["timestamp"]), "sumOpenInterest": float(r["openInterest"])}
        for r in rows
    ]
