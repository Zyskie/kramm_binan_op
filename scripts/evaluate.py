"""Hourly evaluation entrypoint.

Fetches Binance USD-M Futures data for BTC/ETH/BNB, computes a 9-indicator
confluence checklist for LONG and SHORT, manages simulated (paper) positions,
and persists everything under docs/data/ so the static dashboard (docs/index.html)
and the GitHub-hosted history can read it.

This script does NOT send emails or touch git itself -- it only computes and
writes JSON. The calling agent reads docs/data/pending_emails.json after this
runs, sends any emails it finds there via the Gmail connector, then commits
and pushes the repo (including clearing pending_emails.json).

No external dependencies: stdlib only.
"""

import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from binance_api import get_klines, get_funding_rate, get_open_interest_hist
from indicators import ema_last, rsi, macd, atr, adx, bollinger, sma

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data")
SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"]
RISK_ATR_MULT = 1.5
REWARD_ATR_MULT = 3.0
FUNDING_CAP = 0.0003  # 0.03% per 8h


def load_json(name, default):
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(name, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)


def now_iso():
    return datetime.datetime.utcnow().isoformat() + "Z"


def analyze_symbol(symbol):
    k1h = get_klines(symbol, "1h", 500)
    k4h = get_klines(symbol, "4h", 300)
    closes1h = [c["close"] for c in k1h]
    highs1h = [c["high"] for c in k1h]
    lows1h = [c["low"] for c in k1h]
    vols1h = [c["volume"] for c in k1h]
    closes4h = [c["close"] for c in k4h]

    ema50_1h = ema_last(closes1h, 50)
    ema200_1h = ema_last(closes1h, 200)
    ema50_4h = ema_last(closes4h, 50)
    ema200_4h = ema_last(closes4h, 200)
    rsi_1h = rsi(closes1h, 14)
    macd_1h = macd(closes1h)
    adx_1h = adx(highs1h, lows1h, closes1h, 14)
    atr_1h = atr(highs1h, lows1h, closes1h, 14)
    bb_1h = bollinger(closes1h, 20, 2)
    vol_avg20 = sma(vols1h, 20)
    last_vol = vols1h[-1]
    last_close = closes1h[-1]
    last_high = highs1h[-1]
    last_low = lows1h[-1]

    funding = get_funding_rate(symbol)
    oi_hist = get_open_interest_hist(symbol, "1h", 30)
    oi_now = oi_hist[-1]["sumOpenInterest"] if oi_hist else None
    oi_24h_ago = oi_hist[-25]["sumOpenInterest"] if len(oi_hist) >= 25 else (
        oi_hist[0]["sumOpenInterest"] if oi_hist else None
    )
    price_24h_ago = closes1h[-25] if len(closes1h) > 25 else closes1h[0]

    oi_rising = oi_now is not None and oi_24h_ago is not None and oi_now > oi_24h_ago
    price_rising = last_close > price_24h_ago
    price_falling = last_close < price_24h_ago

    long_checks = {
        "Tendencia 1h (EMA50>EMA200 y precio sobre EMA50)": bool(
            ema50_1h and ema200_1h and ema50_1h > ema200_1h and last_close > ema50_1h
        ),
        "Tendencia 4h confirma alcista (EMA50>EMA200)": bool(
            ema50_4h and ema200_4h and ema50_4h > ema200_4h
        ),
        "MACD alcista (linea>señal, histograma>0)": bool(
            macd_1h and macd_1h["macd"] > macd_1h["signal"] and macd_1h["hist"] > 0
        ),
        "RSI en zona sana (40-68)": bool(rsi_1h and 40 <= rsi_1h <= 68),
        "ADX>25 con +DI>-DI (tendencia fuerte)": bool(
            adx_1h and adx_1h["adx"] > 25 and adx_1h["plus_di"] > adx_1h["minus_di"]
        ),
        "Volumen > 1.2x promedio 20": bool(last_vol > 1.2 * vol_avg20),
        "Precio sobre banda media (BB20)": bool(bb_1h and last_close > bb_1h["middle"]),
        f"Funding rate no sobrecalentado (<{FUNDING_CAP*100:.2f}%)": funding < FUNDING_CAP,
        "Open Interest confirma (sube junto al precio, 24h)": bool(oi_rising and price_rising),
    }
    short_checks = {
        "Tendencia 1h (EMA50<EMA200 y precio bajo EMA50)": bool(
            ema50_1h and ema200_1h and ema50_1h < ema200_1h and last_close < ema50_1h
        ),
        "Tendencia 4h confirma bajista (EMA50<EMA200)": bool(
            ema50_4h and ema200_4h and ema50_4h < ema200_4h
        ),
        "MACD bajista (linea<señal, histograma<0)": bool(
            macd_1h and macd_1h["macd"] < macd_1h["signal"] and macd_1h["hist"] < 0
        ),
        "RSI en zona sana (32-60)": bool(rsi_1h and 32 <= rsi_1h <= 60),
        "ADX>25 con -DI>+DI (tendencia fuerte)": bool(
            adx_1h and adx_1h["adx"] > 25 and adx_1h["minus_di"] > adx_1h["plus_di"]
        ),
        "Volumen > 1.2x promedio 20": bool(last_vol > 1.2 * vol_avg20),
        "Precio bajo banda media (BB20)": bool(bb_1h and last_close < bb_1h["middle"]),
        f"Funding rate no sobre-negativo (>-{FUNDING_CAP*100:.2f}%)": funding > -FUNDING_CAP,
        "Open Interest confirma (sube con precio cayendo, 24h)": bool(oi_rising and price_falling),
    }

    return {
        "symbol": symbol,
        "price": last_close,
        "high": last_high,
        "low": last_low,
        "atr": atr_1h,
        "rsi": rsi_1h,
        "funding_rate": funding,
        "long_checks": long_checks,
        "short_checks": short_checks,
        "long_signal": all(long_checks.values()),
        "short_signal": all(short_checks.values()),
        "timestamp": now_iso(),
    }


def manage_position(symbol, analysis, positions, trades, pending_emails):
    pos = positions.get(symbol)
    if pos:
        if pos["direction"] == "LONG":
            hit_sl = analysis["low"] <= pos["sl"]
            hit_tp = analysis["high"] >= pos["tp"]
        else:
            hit_sl = analysis["high"] >= pos["sl"]
            hit_tp = analysis["low"] <= pos["tp"]
        if hit_sl or hit_tp:
            # conservative: if both touched in the same candle, assume SL first
            outcome = "SL" if hit_sl else "TP"
            exit_price = pos["sl"] if hit_sl else pos["tp"]
            pnl_pct = (
                (exit_price - pos["entry"]) / pos["entry"]
                if pos["direction"] == "LONG"
                else (pos["entry"] - exit_price) / pos["entry"]
            )
            trade = dict(pos)
            trade.update(
                exit=exit_price,
                exit_time=analysis["timestamp"],
                outcome=outcome,
                pnl_pct=round(pnl_pct * 100, 3),
            )
            trades.append(trade)
            del positions[symbol]
            pending_emails.append(
                {
                    "subject": f"{'✅' if outcome == 'TP' else '🛑'} Trade cerrado: {pos['direction']} {symbol} ({outcome}) {trade['pnl_pct']}%",
                    "body": (
                        f"Se cerro la operacion SIMULADA {pos['direction']} en {symbol}.\n\n"
                        f"Entrada: {pos['entry']}\n"
                        f"Salida: {exit_price}\n"
                        f"Resultado: {trade['pnl_pct']}%\n"
                        f"Motivo: {'Take Profit alcanzado' if outcome == 'TP' else 'Stop Loss alcanzado'}\n"
                        f"Abierta: {pos['opened_at']}\n"
                        f"Cerrada: {analysis['timestamp']}\n"
                    ),
                }
            )
        return

    if analysis["long_signal"] or analysis["short_signal"]:
        direction = "LONG" if analysis["long_signal"] else "SHORT"
        checks = analysis["long_checks"] if direction == "LONG" else analysis["short_checks"]
        entry = analysis["price"]
        risk = RISK_ATR_MULT * analysis["atr"]
        reward = REWARD_ATR_MULT * analysis["atr"]
        sl = entry - risk if direction == "LONG" else entry + risk
        tp = entry + reward if direction == "LONG" else entry - reward
        positions[symbol] = {
            "symbol": symbol,
            "direction": direction,
            "entry": entry,
            "sl": round(sl, 6),
            "tp": round(tp, 6),
            "opened_at": analysis["timestamp"],
        }
        checklist_txt = "\n".join(f"[OK] {k}" for k in checks)
        pending_emails.append(
            {
                "subject": f"🟢 Señal {direction} en {symbol} — {len(checks)}/{len(checks)} indicadores confirmados",
                "body": (
                    f"Se cumplieron TODOS los indicadores para abrir {direction} en {symbol} (SIMULADO, sin ejecucion real todavia).\n\n"
                    f"Entrada: {entry}\n"
                    f"Stop Loss: {round(sl, 6)}\n"
                    f"Take Profit: {round(tp, 6)}\n\n"
                    f"Indicadores confirmados:\n{checklist_txt}\n\n"
                    f"Te avisaremos por mail cuando esta operacion simulada se cierre (TP o SL)."
                ),
            }
        )


def main():
    positions = load_json("positions.json", {})
    trades = load_json("trades.json", [])
    history = load_json("history.json", [])
    pending_emails = []
    latest = {}

    for symbol in SYMBOLS:
        analysis = analyze_symbol(symbol)
        manage_position(symbol, analysis, positions, trades, pending_emails)
        latest[symbol] = analysis
        history.append(analysis)

    history = history[-1500:]

    save_json("positions.json", positions)
    save_json("trades.json", trades)
    save_json("history.json", history)
    save_json(
        "latest.json",
        {"generated_at": now_iso(), "symbols": latest, "open_positions": positions},
    )
    save_json("pending_emails.json", pending_emails)
    print(json.dumps({"pending_emails": len(pending_emails), "generated_at": now_iso()}))


if __name__ == "__main__":
    main()
