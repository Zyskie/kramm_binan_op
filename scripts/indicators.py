"""Pure-stdlib technical indicator calculations. No external dependencies."""


def sma(values, period):
    return sum(values[-period:]) / period


def ema_series(values, period):
    if len(values) < period:
        return []
    k = 2 / (period + 1)
    out = [sum(values[:period]) / period]
    for price in values[period:]:
        out.append(price * k + out[-1] * (1 - k))
    return out


def ema_last(values, period):
    series = ema_series(values, period)
    return series[-1] if series else None


def rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(closes, fast=12, slow=26, signal=9):
    if len(closes) < slow + signal:
        return None
    ema_fast = ema_series(closes, fast)
    ema_slow = ema_series(closes, slow)
    offset = len(ema_fast) - len(ema_slow)
    macd_line = [ema_fast[i + offset] - ema_slow[i] for i in range(len(ema_slow))]
    signal_line = ema_series(macd_line, signal)
    if not signal_line:
        return None
    hist = macd_line[-1] - signal_line[-1]
    return {"macd": macd_line[-1], "signal": signal_line[-1], "hist": hist}


def atr(highs, lows, closes, period=14):
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    atr_val = sum(trs[:period]) / period
    for v in trs[period:]:
        atr_val = (atr_val * (period - 1) + v) / period
    return atr_val


def adx(highs, lows, closes, period=14):
    n = len(closes)
    if n < period * 2:
        return None
    plus_dm, minus_dm, trs = [], [], []
    for i in range(1, n):
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        plus_dm.append(up_move if (up_move > down_move and up_move > 0) else 0)
        minus_dm.append(down_move if (down_move > up_move and down_move > 0) else 0)
        trs.append(
            max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
        )

    def wilder_smooth(vals):
        smoothed = [sum(vals[:period])]
        for v in vals[period:]:
            smoothed.append(smoothed[-1] - smoothed[-1] / period + v)
        return smoothed

    sm_plus = wilder_smooth(plus_dm)
    sm_minus = wilder_smooth(minus_dm)
    sm_tr = wilder_smooth(trs)
    plus_di = [100 * (sm_plus[i] / sm_tr[i]) if sm_tr[i] else 0 for i in range(len(sm_tr))]
    minus_di = [100 * (sm_minus[i] / sm_tr[i]) if sm_tr[i] else 0 for i in range(len(sm_tr))]
    dx = [
        100 * abs(plus_di[i] - minus_di[i]) / (plus_di[i] + minus_di[i])
        if (plus_di[i] + minus_di[i])
        else 0
        for i in range(len(plus_di))
    ]
    if len(dx) < period:
        return None
    adx_val = sum(dx[:period]) / period
    for v in dx[period:]:
        adx_val = (adx_val * (period - 1) + v) / period
    return {"adx": adx_val, "plus_di": plus_di[-1], "minus_di": minus_di[-1]}


def bollinger(closes, period=20, mult=2):
    if len(closes) < period:
        return None
    window = closes[-period:]
    mean = sum(window) / period
    variance = sum((c - mean) ** 2 for c in window) / period
    std = variance ** 0.5
    return {"upper": mean + mult * std, "middle": mean, "lower": mean - mult * std}
