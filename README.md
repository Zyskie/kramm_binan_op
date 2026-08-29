# Kramm Bybit Monitor

Monitoreo horario de BTC, ETH y BNB (perpetuos USD-M) con un checklist de
9 indicadores técnicos por dirección (LONG / SHORT). Cuando **todos** los
indicadores de una dirección se cumplen, se registra una operación **simulada**
(paper trade) y se envía un mail de aviso. Cuando esa posición simulada toca su
Take Profit o Stop Loss, se envía un segundo mail con el resultado.

**Esto no ejecuta operaciones reales todavía.** Es la fase de validación: medir
qué hubiera pasado si operáramos con este criterio, antes de conectar ejecución
real. Ningún set de indicadores garantiza ganancias — el objetivo es maximizar
probabilidad a favor (edge), no eliminar el riesgo.

## Cómo funciona

Un routine programado (cada 1h) corre `scripts/evaluate.py`, que:

1. Trae velas 1h y 4h de Bybit (perpetuos USD-M, `api.bybit.com/v5/market/*`,
   endpoints públicos, sin API key) para `BTCUSDT`, `ETHUSDT`, `BNBUSDT`.
   Se usa Bybit y no Binance porque la API pública de Binance Futures
   (`fapi.binance.com`) devuelve HTTP 451 a las IPs del entorno cloud; los
   precios e indicadores de estos majors son casi idénticos entre ambos.
2. Calcula: EMA50/EMA200 (1h y 4h), MACD, RSI14, ADX14 (+DI/-DI), ATR14,
   Bandas de Bollinger(20,2), volumen vs. promedio 20, funding rate y
   Open Interest (24h).
3. Evalúa un checklist de 9 condiciones para LONG y 9 para SHORT
   (ver `scripts/evaluate.py::analyze_symbol`).
4. Si no hay posición simulada abierta para el símbolo y se cumplen las 9
   condiciones de una dirección → abre una posición simulada (SL = 1.5×ATR,
   TP = 3×ATR, es decir 2:1 reward\:risk) y encola un mail de apertura.
5. Si hay una posición simulada abierta, chequea si la vela tocó SL o TP; si
   es así, la cierra, registra el resultado en `docs/data/trades.json` y
   encola un mail de cierre.
6. Escribe todo en `docs/data/*.json`.

El agente que corre el routine (no el script Python) lee
`docs/data/pending_emails.json` después de ejecutar el script, envía esos
mails por Gmail, y hace commit + push de los cambios en `docs/`.

## Dashboard

`docs/index.html` es un dashboard estático que lee los JSON de `docs/data/`.
Se sirve gratis con GitHub Pages apuntando a la carpeta `/docs` de la rama
`main`. Muestra: precios actuales, checklist LONG/SHORT por símbolo (✓ verde /
✕ rojo), posiciones simuladas abiertas y el historial de operaciones cerradas
con win rate y PnL acumulado.

## Estructura

```
scripts/
  market_api.py      # cliente HTTP a Bybit v5 market data (stdlib only)
  indicators.py       # EMA, MACD, RSI, ADX, ATR, Bollinger (stdlib only)
  evaluate.py          # orquestador: fetch + indicadores + paper trading + persistencia
docs/
  index.html           # dashboard estático (GitHub Pages)
  data/
    positions.json     # posiciones simuladas abiertas
    trades.json         # historial de operaciones cerradas
    history.json         # snapshot de cada corrida horaria (para históricos)
    latest.json           # último snapshot (lo consume el dashboard)
    pending_emails.json    # mails a enviar en la corrida actual (se vacía tras enviarlos)
```

## Próximos pasos (fuera de esta iteración)

- Conectar ejecución real de órdenes (API key con permisos de trading) cuando
  se valide el criterio con suficientes operaciones simuladas.
- Ajustar umbrales de los indicadores según el resultado del historial.
