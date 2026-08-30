# Kramm Bybit Monitor — Vercel

Migración del monitor (`../scripts/*.py` + `../docs/`) a un único proyecto de
Next.js pensado para correr **100% en Vercel** (front y back), evitando la
máquina local en Uruguay que usa el sistema original.

El sistema Python/local en la raíz del repo **no se tocó** y sigue
funcionando igual — esto es una implementación paralela. Podés migrar cuando
confirmes que anda bien acá, y retirar `run_local.ps1` después.

## Por qué esta arquitectura

- **Bybit/Binance geo-bloquean IPs de datacenter en EE.UU.** (HTTP 403/451).
  La función que llama a Bybit está fijada a la región `gru1` (São Paulo) —
  ver `"regions"` en `vercel.json` y `preferredRegion` en
  `app/api/evaluate/route.ts`. En el plan Hobby (gratis) solo se puede elegir
  **una** región, así que las dos configuraciones apuntan a la misma.
- **Vercel no tiene disco persistente entre invocaciones.** Lo que antes eran
  `docs/data/*.json` commiteados a git ahora se guarda en **Upstash Redis**
  (integración gratuita del Marketplace de Vercel).
- **Los Cron Jobs nativos de Vercel en el plan Hobby corren como máximo 1 vez
  por día** (una expresión horaria falla el deploy). Para correr cada hora
  gratis, un servicio externo (cron-job.org, GitHub Actions, etc.) le pega a
  `/api/evaluate` cada hora — ver más abajo. Si en algún momento pasás a
  Pro (20 USD/mes), se puede reemplazar por un Cron Job nativo de Vercel.
- El envío de mails sigue siendo Gmail SMTP (mismo app password que ya
  tenías), vía `nodemailer` desde la función serverless.

## Estructura

```
web/
  app/
    page.tsx            # dashboard (Server Component, lee de Redis)
    api/evaluate/route.ts  # endpoint protegido que corre la evaluación
  lib/
    bybit.ts             # cliente Bybit v5 (klines, funding, open interest)
    indicators.ts         # EMA, MACD, RSI, ADX, ATR, Bollinger
    evaluate.ts            # checklist de 9 condiciones + paper trading
    store.ts               # persistencia en Upstash Redis
    mailer.ts               # envío de mails vía Gmail SMTP
```

## Deploy

1. **Importar el proyecto en Vercel** apuntando a este repo, con
   **Root Directory = `web`**.
2. **Storage → Marketplace Database Providers → Upstash → Redis**: crear una
   base y conectarla al proyecto. Esto agrega automáticamente las env vars
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN`, ambas están soportadas).
3. **Settings → Environment Variables**, agregar (ver `.env.example`):
   - `CRON_SECRET`: string random (`openssl rand -hex 32`) para autenticar
     al scheduler externo.
   - `KRAMM_GMAIL_USER`: la cuenta de Gmail que envía los mails.
   - `KRAMM_GMAIL_APP_PW`: app password de esa cuenta (mismo que usaba
     `run_local.ps1`).
   - `KRAMM_ALERT_EMAIL_TO` (opcional): destinatario, si no es la misma
     cuenta de `KRAMM_GMAIL_USER`.
4. **Settings → Functions → Function Region**: confirmar que quedó en
   `gru1` (São Paulo) o el que hayas elegido en `vercel.json`. Si Bybit
   sigue devolviendo 403 desde esa región, probar otra región sudamericana
   o europea (ninguna está en la lista de países restringidos de Bybit).
5. Deploy.

## Scheduler externo (para que corra cada hora, gratis)

`../.github/workflows/hourly-evaluate.yml` ya hace esto: cada hora (minuto
`0`, UTC) le pega un `GET` a `/api/evaluate?secret=...` vía GitHub Actions,
gratis, versionado junto con el resto del repo -- no depende de una cuenta
de terceros como cron-job.org. Solo falta:

1. Editar la URL del workflow si el dominio de producción cambia (por
   defecto apunta a `https://web-eta-pink-76.vercel.app`).
2. Cargar el secreto en el repo: **Settings → Secrets and variables →
   Actions → New repository secret**, nombre `KRAMM_CRON_SECRET`, mismo
   valor que `CRON_SECRET` en Vercel.

Se puede disparar a mano desde la pestaña **Actions** del repo ("Run
workflow") para probar sin esperar a la próxima hora en punto. Sin el
secreto correcto, `/api/evaluate` devuelve `401`.

Alternativa si preferís no depender de GitHub Actions: cualquier servicio de
cron externo (ej. [cron-job.org](https://cron-job.org)) pegándole a la misma
URL cada hora funciona igual.

## Desarrollo local

```bash
cd web
npm install
cp .env.example .env.local   # completar las variables
npm run dev
```

`npm run build` valida tipos y que la app compile; no requiere las
credenciales de Redis para buildear (se leen recién en el primer request real).
