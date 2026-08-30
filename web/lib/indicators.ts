// Technical indicator calculations. Ported 1:1 from scripts/indicators.py.

export function sma(values: number[], period: number): number {
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [seed];
  for (const price of values.slice(period)) {
    out.push(price * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

export function emaLast(values: number[], period: number): number | null {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type Macd = { macd: number; signal: number; hist: number };

export function macd(closes: number[], fast = 12, slow = 26, signal = 9): Macd | null {
  if (closes.length < slow + signal) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const offset = emaFast.length - emaSlow.length;
  const macdLine = emaSlow.map((_, i) => emaFast[i + offset] - emaSlow[i]);
  const signalLine = emaSeries(macdLine, signal);
  if (!signalLine.length) return null;
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine[signalLine.length - 1];
  return { macd: macdVal, signal: signalVal, hist: macdVal - signalVal };
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }
  if (trs.length < period) return null;
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const v of trs.slice(period)) {
    atrVal = (atrVal * (period - 1) + v) / period;
  }
  return atrVal;
}

export type Adx = { adx: number; plus_di: number; minus_di: number };

export function adx(highs: number[], lows: number[], closes: number[], period = 14): Adx | null {
  const n = closes.length;
  if (n < period * 2) return null;
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      )
    );
  }

  function wilderSmooth(vals: number[]): number[] {
    const smoothed = [vals.slice(0, period).reduce((a, b) => a + b, 0)];
    for (const v of vals.slice(period)) {
      smoothed.push(smoothed[smoothed.length - 1] - smoothed[smoothed.length - 1] / period + v);
    }
    return smoothed;
  }

  const smPlus = wilderSmooth(plusDm);
  const smMinus = wilderSmooth(minusDm);
  const smTr = wilderSmooth(trs);
  const plusDi = smTr.map((tr, i) => (tr ? (100 * smPlus[i]) / tr : 0));
  const minusDi = smTr.map((tr, i) => (tr ? (100 * smMinus[i]) / tr : 0));
  const dx = plusDi.map((p, i) => {
    const m = minusDi[i];
    return p + m ? (100 * Math.abs(p - m)) / (p + m) : 0;
  });
  if (dx.length < period) return null;
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const v of dx.slice(period)) {
    adxVal = (adxVal * (period - 1) + v) / period;
  }
  return { adx: adxVal, plus_di: plusDi[plusDi.length - 1], minus_di: minusDi[minusDi.length - 1] };
}

export type Bollinger = { upper: number; middle: number; lower: number };

export function bollinger(closes: number[], period = 20, mult = 2): Bollinger | null {
  if (closes.length < period) return null;
  const window = closes.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, c) => a + (c - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}
