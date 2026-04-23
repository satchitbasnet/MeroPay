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

Use the Scan tab and paste URLs like:

- `https://app.meropay.com/pay/@sita_pkr`
- `https://app.meropay.com/pay/@coffee_shop?amount=500`

The app parses the URL, pre-fills payee/amount, and calls `POST /api/transfer`.

## Build

```bash
npm run build
npm run preview
```

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