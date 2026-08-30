// Ported 1:1 from scripts/evaluate.py -- checklist of 9 confluence
// indicators per direction (LONG/SHORT), paper-position open/close logic.

import { getKlines, getFundingRate, getOpenInterestHist, type Candle } from "./bybit";
import { emaLast, rsi, macd, atr, adx, bollinger, sma } from "./indicators";
import type { PendingEmail } from "./mailer";

export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT"] as const;
const RISK_ATR_MULT = 1.5;
const REWARD_ATR_MULT = 3.0;
const FUNDING_CAP = 0.0003; // 0.03% per 8h

export type Analysis = {
  symbol: string;
  price: number;
  high: number;
  low: number;
  atr: number | null;
  rsi: number | null;
  funding_rate: number;
  long_checks: Record<string, boolean>;
  short_checks: Record<string, boolean>;
  long_signal: boolean;
  short_signal: boolean;
  timestamp: string;
};

export type Position = {
  symbol: string;
  direction: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
  opened_at: string;
};

export type Trade = Position & {
  exit: number;
  exit_time: string;
  outcome: "TP" | "SL";
  pnl_pct: number;
};

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

export async function analyzeSymbol(symbol: string): Promise<{ analysis: Analysis; candles: Candle[] }> {
  const [k1h, k4h] = await Promise.all([getKlines(symbol, "1h", 500), getKlines(symbol, "4h", 300)]);
  const closes1h = k1h.map((c) => c.close);
  const highs1h = k1h.map((c) => c.high);
  const lows1h = k1h.map((c) => c.low);
  const vols1h = k1h.map((c) => c.volume);
  const closes4h = k4h.map((c) => c.close);

  const ema50_1h = emaLast(closes1h, 50);
  const ema200_1h = emaLast(closes1h, 200);
  const ema50_4h = emaLast(closes4h, 50);
  const ema200_4h = emaLast(closes4h, 200);
  const rsi1h = rsi(closes1h, 14);
  const macd1h = macd(closes1h);
  const adx1h = adx(highs1h, lows1h, closes1h, 14);
  const atr1h = atr(highs1h, lows1h, closes1h, 14);
  const bb1h = bollinger(closes1h, 20, 2);
  const volAvg20 = sma(vols1h, 20);
  const lastVol = vols1h[vols1h.length - 1];
  const lastClose = closes1h[closes1h.length - 1];
  const lastHigh = highs1h[highs1h.length - 1];
  const lastLow = lows1h[lows1h.length - 1];

  const [funding, oiHist] = await Promise.all([
    getFundingRate(symbol),
    getOpenInterestHist(symbol, "1h", 30),
  ]);
  const oiNow = oiHist.length ? oiHist[oiHist.length - 1].sumOpenInterest : null;
  const oi24hAgo =
    oiHist.length >= 25
      ? oiHist[oiHist.length - 25].sumOpenInterest
      : oiHist.length
      ? oiHist[0].sumOpenInterest
      : null;
  const price24hAgo = closes1h.length > 25 ? closes1h[closes1h.length - 25] : closes1h[0];

  const oiRising = oiNow !== null && oi24hAgo !== null && oiNow > oi24hAgo;
  const priceRising = lastClose > price24hAgo;
  const priceFalling = lastClose < price24hAgo;

  const longChecks: Record<string, boolean> = {
    "Tendencia 1h (EMA50>EMA200 y precio sobre EMA50)": Boolean(
      ema50_1h && ema200_1h && ema50_1h > ema200_1h && lastClose > ema50_1h
    ),
    "Tendencia 4h confirma alcista (EMA50>EMA200)": Boolean(ema50_4h && ema200_4h && ema50_4h > ema200_4h),
    "MACD alcista (linea>señal, histograma>0)": Boolean(macd1h && macd1h.macd > macd1h.signal && macd1h.hist > 0),
    "RSI en zona sana (40-68)": Boolean(rsi1h !== null && rsi1h >= 40 && rsi1h <= 68),
    "ADX>25 con +DI>-DI (tendencia fuerte)": Boolean(adx1h && adx1h.adx > 25 && adx1h.plus_di > adx1h.minus_di),
    "Volumen > 1.2x promedio 20": lastVol > 1.2 * volAvg20,
    "Precio sobre banda media (BB20)": Boolean(bb1h && lastClose > bb1h.middle),
    [`Funding rate no sobrecalentado (<${(FUNDING_CAP * 100).toFixed(2)}%)`]: funding < FUNDING_CAP,
    "Open Interest confirma (sube junto al precio, 24h)": Boolean(oiRising && priceRising),
  };
  const shortChecks: Record<string, boolean> = {
    "Tendencia 1h (EMA50<EMA200 y precio bajo EMA50)": Boolean(
      ema50_1h && ema200_1h && ema50_1h < ema200_1h && lastClose < ema50_1h
    ),
    "Tendencia 4h confirma bajista (EMA50<EMA200)": Boolean(ema50_4h && ema200_4h && ema50_4h < ema200_4h),
    "MACD bajista (linea<señal, histograma<0)": Boolean(macd1h && macd1h.macd < macd1h.signal && macd1h.hist < 0),
    "RSI en zona sana (32-60)": Boolean(rsi1h !== null && rsi1h >= 32 && rsi1h <= 60),
    "ADX>25 con -DI>+DI (tendencia fuerte)": Boolean(adx1h && adx1h.adx > 25 && adx1h.minus_di > adx1h.plus_di),
    "Volumen > 1.2x promedio 20": lastVol > 1.2 * volAvg20,
    "Precio bajo banda media (BB20)": Boolean(bb1h && lastClose < bb1h.middle),
    [`Funding rate no sobre-negativo (>-${(FUNDING_CAP * 100).toFixed(2)}%)`]: funding > -FUNDING_CAP,
    "Open Interest confirma (sube con precio cayendo, 24h)": Boolean(oiRising && priceFalling),
  };

  const analysis: Analysis = {
    symbol,
    price: lastClose,
    high: lastHigh,
    low: lastLow,
    atr: atr1h,
    rsi: rsi1h,
    funding_rate: funding,
    long_checks: longChecks,
    short_checks: shortChecks,
    long_signal: Object.values(longChecks).every(Boolean),
    short_signal: Object.values(shortChecks).every(Boolean),
    timestamp: nowIso(),
  };

  return { analysis, candles: k1h };
}

export function managePosition(
  symbol: string,
  analysis: Analysis,
  candles: Candle[],
  positions: Record<string, Position>,
  trades: Trade[],
  pendingEmails: PendingEmail[]
): void {
  const pos = positions[symbol];
  if (pos) {
    const openedMs = isoToMs(pos.opened_at);
    let outcome: "TP" | "SL" | null = null;
    let exitPrice: number | null = null;
    let exitTime = analysis.timestamp;
    for (const c of candles) {
      if (c.close_time < openedMs) continue;
      const cSl = pos.direction === "LONG" ? c.low <= pos.sl : c.high >= pos.sl;
      const cTp = pos.direction === "LONG" ? c.high >= pos.tp : c.low <= pos.tp;
      if (cSl || cTp) {
        outcome = cSl ? "SL" : "TP";
        exitPrice = cSl ? pos.sl : pos.tp;
        const nowMs = isoToMs(analysis.timestamp);
        exitTime = msToIso(Math.min(c.close_time, nowMs));
        break;
      }
    }
    if (outcome && exitPrice !== null) {
      const pnlPct =
        pos.direction === "LONG"
          ? (exitPrice - pos.entry) / pos.entry
          : (pos.entry - exitPrice) / pos.entry;
      const trade: Trade = {
        ...pos,
        exit: exitPrice,
        exit_time: exitTime,
        outcome,
        pnl_pct: Math.round(pnlPct * 100 * 1000) / 1000,
      };
      trades.push(trade);
      delete positions[symbol];
      pendingEmails.push({
        subject: `${outcome === "TP" ? "✅" : "🛑"} Trade cerrado: ${pos.direction} ${symbol} (${outcome}) ${trade.pnl_pct}%`,
        body:
          `Se cerro la operacion SIMULADA ${pos.direction} en ${symbol}.\n\n` +
          `Entrada: ${pos.entry}\n` +
          `Salida: ${exitPrice}\n` +
          `Resultado: ${trade.pnl_pct}%\n` +
          `Motivo: ${outcome === "TP" ? "Take Profit alcanzado" : "Stop Loss alcanzado"}\n` +
          `Abierta: ${pos.opened_at}\n` +
          `Cerrada: ${exitTime}\n`,
      });
    }
    return;
  }

  if (analysis.long_signal || analysis.short_signal) {
    const direction: "LONG" | "SHORT" = analysis.long_signal ? "LONG" : "SHORT";
    const checks = direction === "LONG" ? analysis.long_checks : analysis.short_checks;
    const entry = analysis.price;
    const atrVal = analysis.atr ?? 0;
    const risk = RISK_ATR_MULT * atrVal;
    const reward = REWARD_ATR_MULT * atrVal;
    const sl = direction === "LONG" ? entry - risk : entry + risk;
    const tp = direction === "LONG" ? entry + reward : entry - reward;
    positions[symbol] = {
      symbol,
      direction,
      entry,
      sl: Math.round(sl * 1e6) / 1e6,
      tp: Math.round(tp * 1e6) / 1e6,
      opened_at: analysis.timestamp,
    };
    const checklistTxt = Object.keys(checks)
      .map((k) => `[OK] ${k}`)
      .join("\n");
    const n = Object.keys(checks).length;
    pendingEmails.push({
      subject: `🟢 Señal ${direction} en ${symbol} — ${n}/${n} indicadores confirmados`,
      body:
        `Se cumplieron TODOS los indicadores para abrir ${direction} en ${symbol} (SIMULADO, sin ejecucion real todavia).\n\n` +
        `Entrada: ${entry}\n` +
        `Stop Loss: ${Math.round(sl * 1e6) / 1e6}\n` +
        `Take Profit: ${Math.round(tp * 1e6) / 1e6}\n\n` +
        `Indicadores confirmados:\n${checklistTxt}\n\n` +
        `Te avisaremos por mail cuando esta operacion simulada se cierre (TP o SL).`,
    });
  }
}

export type LatestSnapshot = {
  generated_at: string;
  symbols: Record<string, Analysis>;
  open_positions: Record<string, Position>;
};

export async function runEvaluation(
  positions: Record<string, Position>,
  trades: Trade[],
  history: Analysis[]
): Promise<{
  positions: Record<string, Position>;
  trades: Trade[];
  history: Analysis[];
  latest: LatestSnapshot;
  pendingEmails: PendingEmail[];
}> {
  const pendingEmails: PendingEmail[] = [];
  const latestSymbols: Record<string, Analysis> = {};

  for (const symbol of SYMBOLS) {
    const { analysis, candles } = await analyzeSymbol(symbol);
    managePosition(symbol, analysis, candles, positions, trades, pendingEmails);
    latestSymbols[symbol] = analysis;
    history.push(analysis);
  }

  const trimmedHistory = history.slice(-1500);

  return {
    positions,
    trades,
    history: trimmedHistory,
    latest: { generated_at: nowIso(), symbols: latestSymbols, open_positions: positions },
    pendingEmails,
  };
}
