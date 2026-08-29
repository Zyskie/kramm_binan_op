"""Thin client for Binance USD-M Futures public endpoints. No API key needed
(all data used is public market data)."""

import json
import urllib.request

BASE = "https://fapi.binance.com"


def _get(path, params=None):
    url = BASE + path
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url += "?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def get_klines(symbol, interval, limit=500):
    data = _get("/fapi/v1/klines", {"symbol": symbol, "interval": interval, "limit": limit})
    return [
        {
            "open_time": c[0],
            "open": float(c[1]),
            "high": float(c[2]),
            "low": float(c[3]),
            "close": float(c[4]),
            "volume": float(c[5]),
            "close_time": c[6],
        }
        for c in data
    ]


def get_last_price(symbol):
    data = _get("/fapi/v1/ticker/price", {"symbol": symbol})
    return float(data["price"])


def get_funding_rate(symbol):
    data = _get("/fapi/v1/fundingRate", {"symbol": symbol, "limit": 1})
    return float(data[-1]["fundingRate"]) if data else 0.0


def get_open_interest_hist(symbol, period="1h", limit=30):
    data = _get(
        "/futures/data/openInterestHist",
        {"symbol": symbol, "period": period, "limit": limit},
    )
    return [
        {"timestamp": d["timestamp"], "sumOpenInterest": float(d["sumOpenInterest"])}
        for d in data
    ]
