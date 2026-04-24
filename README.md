# MeroPay

MeroPay is a Vite-based payment app prototype with Home, Send, Activity, Profile, transaction detail, and person profile flows.

## Requirements

- Node.js 18+ (recommended)
- npm

## Run Locally

```bash
npm install
npm run dev
npm run server
```

Open `http://localhost:5173/`.

The frontend runs on Vite and the payment API runs on Express at `http://localhost:3000`.

## QR Payment Flow (Local)

QR payments use signed tokens. In Receive, the app requests a secure QR URL from backend (`POST /api/qr/create`). In Scan, paste the secure URL:

- `https://app.meropay.com/pay?t=<signed_token>`

The app verifies the token with `POST /api/qr/verify`, then pre-fills payee/amount from the verified intent and submits payment to `POST /api/transfer`.

## Build

```bash
npm run build
npm run preview
```

## Smoke Check

Run a local smoke check for frontend build + backend health:

```bash
npm run smoke
```

`smoke` performs:

- `npm run build`
- backend health probe against `GET /api/health`

Security smoke:

```bash
npm run security:smoke
```

This validates key security paths (auth/idempotency/QR validation) against a running backend.

## Auto Git Commit (Local)

This project includes a local watcher script that auto-commits after a short idle period.

```bash
npm run auto:sync
```

Current behavior:

- Watches project files for changes
- Debounces for 45 seconds after the last edit
- Creates local commits automatically
- Does **not** push to remote

Script path: `scripts/auto-git-sync.ps1`

## API Error Shape

For failed API calls, backend returns:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```