# MeroPay QA Checklist

Last updated: 2026-04-22

## Automated Smoke Checks

- [x] `npm run build` completes successfully.
  - Notes: Vite reports non-blocking `"use client"` and chunk-size warnings.
- [x] `npm run smoke` completes successfully.
  - Notes: Frontend build passes and backend health probe returns `{ ok: true }`.
- [x] Invalid transfer payload returns structured API error object.
  - Notes: Verified on isolated backend instance (`PORT=3001`) with `INVALID_SENDER_ID`.

## Core Manual Flows

### Onboarding
- [ ] Phone onboarding path works end-to-end.
- [ ] Email onboarding path works end-to-end.
- [ ] OTP step enforces required code length.
- [ ] `Use Phone` and `Next` actions appear correctly in email mode.

### Home and Person Profiles
- [ ] `Recent` bubbles open person profile directly (no toast redirect).
- [ ] Person profile `Request` and `Pay` open money flow with recipient prefilled.
- [ ] Balance eye toggle switches open/closed icon and amount masking correctly.

### Send/Request and Transactions
- [ ] Request flow submits and success overlay appears.
- [ ] Pay flow submits and success overlay appears.
- [ ] Transaction detail page labels and values render with updated casing/copy.

### QR Scan/Receive
- [ ] Scan tab parses valid payment URLs and pre-fills receiver.
- [ ] Merchant amount lock works when `amount` query param exists.
- [ ] Receive tab displays user name/tag and QR correctly.

### Profile Edit and Logout
- [ ] Edit Profile tab switching (`Edit`/`Preview`) works without visual glitches.
- [ ] Full Name and Username edits persist across profile and preview sections.
- [ ] Username modal uses `@` prefix and `meropay.np/@...` preview.
- [ ] Log Out opens direct confirmation modal from profile page.
- [ ] Confirmed logout clears auth/onboarding state and returns to onboarding.

### Add Funds and Withdraw
- [ ] Add Funds presets and custom amount input behave correctly.
- [ ] Withdraw flow validates amount and updates fee/summary messaging.
- [ ] Updated labels/casing render correctly in add-funds overlays.

## Android Parity Checks

- [x] `npm run android:sync` succeeds after latest UI changes.
- [x] App opens in Android Studio via `npm run android:open`.
- [ ] Overlay/modal touch targets and close behavior match web.
- [ ] Soft keyboard interactions for onboarding/profile modals are usable.
- [ ] Android back navigation behaves correctly across overlays.
