# MediLink

B2B ordering for pharmacies, distributors and sales reps in India. Shops search once, see live stock and the net price after scheme from every linked distributor, and order in seconds. Orders go straight into the distributor's billing software.

**Platforms:** web (shop, distributor console, admin), Android and iOS (shop app). One codebase per surface, with shared business rules.

## Project layout
| Folder | What it is | Status |
|---|---|---|
| `packages/core` | Shared rules: pricing in paise, Best price, typo-tolerant search, WhatsApp list reading, GSTIN checksum, order status rules, English/Telugu/Hindi text, design tokens | **Built, 20 tests passing** |
| `apps/api` | NestJS API: OTP login, shop registration, catalogue search, cart, orders, distributor actions, sync-agent endpoints, admin and KYC, audit log | Built; needs `pnpm install` to compile |
| `apps/api/prisma` | Database schema, 2 migrations, Hyderabad demo seed | **Migrations and seed tested on PostgreSQL 16** |
| `apps/web` | Next.js web app: login, shop registration, shop home/search/cart/orders/list/account, distributor order lanes, admin panel | Built; needs install to run |
| `apps/mobile` | Expo app for Android + iOS: OTP login, home, search, barcode scan, cart, orders, shortage list, language | Built; needs install to run |
| `apps/sync-agent` | Zero-dependency agent for the distributor's billing PC (CSV adapter for Marg, Tally, Busy, GoFrugal) | **Built, 4 tests passing incl. a full sync cycle** |
| `docs/architecture.md` | Diagram and key decisions | |

## Run it locally
Requirements: Node 20.12+, pnpm 9, Docker Desktop (for PostgreSQL).

```bash
pnpm install
cp .env.example apps/api/.env          # Windows: copy .env.example apps\api\.env
cp .env.example apps/web/.env.local    # Windows: copy .env.example apps\web\.env.local
pnpm db:up                             # starts PostgreSQL in Docker
pnpm db:migrate                        # creates the tables
pnpm db:seed                           # loads Hyderabad demo data
pnpm dev                               # API on :4000 (docs at /api/docs), web on :3000
pnpm dev:mobile                        # Expo: press a for Android, i for iOS simulator
```

Open http://localhost:3000. With `OTP_PROVIDER=console`, the 6-digit login code is printed in the terminal running `pnpm dev`.

### Demo logins (from the seed)
| Role | Mobile |
|---|---|
| Shop owner: Annapurna Medical & General Stores | 9848012345 |
| Shop staff (can add to list, cannot place orders) | 9848012346 |
| Distributor: Sri Venkateswara Pharma (Marg) | 9876500001 |
| Distributor: Lakshmi Medical Agencies (Tally) | 9876500002 |
| Distributor: Deccan Health (Busy, sync shown offline) | 9876500003 |
| Platform admin | 9000000001 |

Shops waiting for KYC approval: Navya Pharmacy (9848066666) and Sri Rama Medicals (9848077777).

## Tests
```bash
pnpm --filter @medilink/core test        # business rules
pnpm --filter @medilink/sync-agent test  # agent incl. a full cycle against a fake API
pnpm --filter @medilink/api test         # end-to-end order flow (needs Postgres with the seed)
```

## Release to the stores
`apps/mobile` uses Expo EAS. Set `projectId` in `app.json` and the App Store Connect ID in `eas.json`, then run `pnpm --filter @medilink/mobile build:production` and `submit`. CI builds both platforms on `v*` tags. You need a Google Play Console account and an Apple Developer **organisation** account (D-U-N-S number).

## What is next (from the build prompt)
- **Phase 2:** direct Marg/Tally adapters, OCR for photos of handwritten lists, WhatsApp ordering, search tuned on real catalogue data
- **Phase 3:** offline mode on the phone, push notifications, fingerprint/Face ID login, Sales Rep app, distributor companion app
- **Phase 4:** UPI payments (Razorpay), notification delivery worker, call-center console, subscriptions, reports
- **Phase 5:** load and security testing, monitoring, backups, store launch

Before launch, also replace the placeholder domain `medilink.example` and add a real support phone number (`NEXT_PUBLIC_SUPPORT_PHONE`).
