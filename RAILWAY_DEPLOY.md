# Railway Deploy

Instant Bees runs as one Railway service:

- Express API
- React frontend served from the API
- Send worker
- Inbox/reply worker
- SQLite database on a Railway volume

## Required Variables

Set these in Railway:

```text
NODE_ENV=production
SQLITE_DATABASE_PATH=/data/sales-automation.sqlite
SESSION_SECRET=<long random value>
ADMIN_USERNAME=<your admin username>
ADMIN_PASSWORD=<your admin password>
CLAUDE_API_KEY=<your Instant Bees API key>
PUBLIC_BASE_URL=https://<your-railway-domain>
ACCOUNT_CAMPAIGN_DAILY_LIMIT=5
ACCOUNT_CAMPAIGN_COOLDOWN_MINUTES=180
ACCOUNT_CAMPAIGN_COOLDOWN_JITTER_MINUTES=30
```

Railway supplies `PORT` automatically.

Optional emergency brakes:

```text
DISABLE_SEND_WORKER=1
DISABLE_INBOX_WORKER=1
```

Do not set these for normal production sending. They are useful for a first smoke test or if you need to pause background processing without taking the dashboard offline.

## Persistent Storage

Add a Railway volume and mount it at:

```text
/data
```

The SQLite file must live on this volume. Without the volume, Railway can redeploy with an empty ephemeral filesystem.

## Build And Start

Railway uses `railway.json`:

```text
Build: corepack pnpm run railway:build
Start: corepack pnpm run railway:start
```

## Moving Local Data

The local database is:

```text
data/sales-automation.sqlite
```

Before uploading/copying it to Railway, stop the local API worker so SQLite writes are flushed. Copy only the main `.sqlite` file after the app is stopped.

Target path on Railway:

```text
/data/sales-automation.sqlite
```

## After Deploy

Update:

```text
PUBLIC_BASE_URL=https://<your-railway-domain>
```

This matters for open tracking pixels, tracked links, unsubscribe links, and API callbacks.
