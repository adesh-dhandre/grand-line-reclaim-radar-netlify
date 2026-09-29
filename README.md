# Grand Line Reclaim Radar — Netlify

Netlify version of the top-100 Binance USDT perpetual meaningful-swing reclaim scanner.

- Static Grand Line dashboard on Netlify CDN.
- Scheduled Function triggers every 5 minutes.
- Background Function scans all 100 pairs (up to 15-minute runtime).
- Netlify Blobs stores status, signal history and duplicate keys across deploys.
- Discord receives original swing touch price/time, sweep touch price/time, and reclaim close price/time.

## Required Netlify environment variables

`DISCORD_WEBHOOK_URL`, `SCAN_TOKEN`, plus optional strategy variables from `.env.example`.

## Deploy

```bash
npm install
npm run check
netlify login
netlify init
netlify env:set DISCORD_WEBHOOK_URL "YOUR_WEBHOOK"
netlify env:set SCAN_TOKEN "$(openssl rand -hex 32)"
netlify env:set DEFAULT_INTERVAL "1h"
netlify env:set TOP_N "100"
netlify env:set PIVOT_BARS "5"
netlify env:set MIN_MOVE_AWAY_ATR "1.0"
netlify deploy --prod
```

The scheduled scan uses `*/5 * * * *` and only runs automatically on the published production deploy.
