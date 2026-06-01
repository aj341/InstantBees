# Local Development

## Requirements

- Node.js 24
- pnpm via Corepack (`corepack pnpm ...` works even when the `pnpm` shim is not installed)
- No external database is required. The API uses a local SQLite file.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `SESSION_SECRET` to any long random string.
3. Install dependencies:

```sh
corepack pnpm install
```

4. Start the API:

```sh
corepack pnpm run dev:api
```

5. In a second terminal, start the web app:

```sh
corepack pnpm run dev:web
```

The frontend runs at `http://localhost:3000` and proxies `/api` to `http://127.0.0.1:8080`.
The SQLite database is created automatically at `data/sales-automation.sqlite`.

Default login is `admin` / `admin` unless you change `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
