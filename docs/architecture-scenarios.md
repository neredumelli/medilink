# MediLink — Architecture & Scenario Handbook

Version 1.0 · 22 Oct 2026 · Owner: Architecture

This is the single reference for **how MediLink behaves in every situation**: normal business, edge cases, failures, attacks, growth and recovery. Every new feature must be checked against it.

**Status key:** ✅ built and tested · 🟡 partly built · ⏳ planned (phase shown)

---

## 0. Design principles

1. **Never lose data, never corrupt money.** All money is integer paise. Every multi-step change is one database transaction: all of it happens, or none of it.
2. **The database is the last line of defence.** Rules that must never break are enforced in PostgreSQL itself, not only in app code.
3. **Every action is traceable.** Who, what, when, before and after values, kept in an append-only activity log.
4. **Every mistake is reversible.** Soft delete, versioned history, import undo, order cancellation and returns. Nothing important is ever hard-deleted.
5. **Fail safe, fail visible.** When something breaks, users see a clear message in their language, data stays safe, and the team is alerted.
6. **Data and settings, not code.** Lists, rules, thresholds, messages and fields are editable in admin.
7. **One way in for data.** All bulk data goes through the Import Hub: map, check, preview, commit, undo.
8. **Open source only, cloud-safe licences.** See the technology stack.

## 1. Technology stack (confirmed)

| Area | Technology | Licence |
|---|---|---|
| Language | TypeScript on Node.js | Apache-2.0 / MIT |
| Website | Next.js + React | MIT |
| Android + iOS | React Native + Expo | MIT |
| Backend | NestJS | MIT |
| Database | PostgreSQL (+ pg_trgm search, row-level security) | PostgreSQL |
| DB toolkit | Prisma | Apache-2.0 |
| Web server / HTTPS / fallback pages | Caddy | Apache-2.0 |
| Packaging | Docker Engine | Apache-2.0 |
| Database backup + point-in-time restore | pgBackRest | MIT |
| File backup | restic | BSD-2 |
| Uptime monitoring + public status page | Uptime Kuma | MIT |
| Load testing | Apache JMeter | Apache-2.0 |
| Code + automated checks | Git + GitHub Actions | — |

Not used, because of licence or lock-in risk: Redis (AGPL/source-available), MongoDB (SSPL), Elasticsearch, Docker Desktop on company PCs, Firebase/Supabase Cloud.

## 2. Architecture overview

| Layer | Responsibility |
|---|---|
| Apps | Website (shop, distributor, admin), Android/iOS shop app, later the sales-rep and distributor companion apps |
| Edge (Caddy) | HTTPS, compression, rate limits, **fallback "we'll be back" page when the backend is down** |
| API `/api/v1` | One versioned API for apps, distributor ERPs and the sync agent; OpenAPI docs |
| Business modules | Catalogue · Pricing · Stock · Orders · Credit & dues · Returns · Users & access · Notifications · Import Hub · Settings · Reports |
| Shared rules (`packages/core`) | Net price, best price, scheme maths, order status rules, validation, translations, shared by API, web and app |
| Event outbox | Events written in the same transaction as the change; workers deliver notifications, webhooks and reports |
| Connectors | Billing-software adapters (CSV ✅; Marg, Tally, Busy, GoFrugal ⏳), SMS, WhatsApp, payments |
| PostgreSQL | Data, constraints, row-level security, trigram search, append-only audit |
| Operations | pgBackRest, restic, Uptime Kuma, logs, runbooks |

## 3. Data architecture (flexible by design)

| Concept | Design | Status |
|---|---|---|
| Master vs reference vs transactions | Separate tables. Reference lists (categories, units, cities, reasons, document types, delivery slots) are **admin-editable tables**, not code | 🟡 enums today → ⏳ P2 |
| Custom fields | JSON "extra details" column on product, shop and distributor, plus a **Field definitions** table (name, type, required, where shown); new fields need no code | ⏳ P2 |
| Product identity | One master product · **aliases** (names used by distributors and shops) · **barcodes** table (many per product) · pack/unit conversion (strip ↔ box) | 🟡 master + mapping ✅ · aliases/barcodes/packs ⏳ P2 |
| Stock | Per distributor item, plus **batches** (batch no, expiry, qty) | 🟡 nearest expiry ✅ · batches ⏳ P2 |
| Pricing | **Price lists** (per distributor, per shop group, valid from/to) and **schemes** (free qty, % off, ₹ off, valid from/to, targeted) | 🟡 single PTR + scheme ✅ · lists ⏳ P2 |
| History | **Versioned** price, credit-limit and product changes ("what was the rate on 12 Oct?") | ⏳ P2 |
| Deletion | **Soft delete** with restore; hard delete only for legal erasure requests | ⏳ P2 |
| Tenant isolation | Ownership checks in every query ✅ + PostgreSQL row-level security | 🟡 ⏳ P2 |
| Money | Integer paise; totals checked by DB constraint | ✅ |
| IDs | UUIDs internally; human codes for people (ML-10241, MLR-20417) | ✅ |

## 4. Import Hub (adding data without hassle)

One pipeline for products, shops, distributors, price lists, schemes, stock, opening dues and credit limits:
**source → column mapping (saved template) → validation → preview → commit as a numbered batch → undo the batch.**

| Scenario | Handling | Status |
|---|---|---|
| Wrong column names | Mapping screen; saved per source (e.g. "Marg stock export") | ⏳ P2 |
| Bad rows (missing name, wrong GSTIN, negative price) | Listed with row number and reason; fix file or skip rows | ⏳ P2 |
| Duplicates within the file or against existing data | Detected by code, GSTIN or barcode and shown; choose update or skip | ⏳ P2 |
| Product names don't match the master | Fuzzy match with confidence; low confidence goes to the mapping queue ✅ | 🟡 |
| Huge file (100k rows) | Processed in background chunks with a progress bar; nothing goes live until commit | ⏳ P2 |
| Import was wrong after commit | **Undo batch** restores previous values from history | ⏳ P2 |
| Two admins import the same data | Batch lock per data type | ⏳ P2 |
| Excel quirks (dates, ₹ signs, commas, BOM, Telugu text) | Normalisers (already in the sync agent CSV reader ✅) | 🟡 |

## 5. Business scenarios

### 5.1 Onboarding and access
| Scenario | Handling | Status |
|---|---|---|
| New shop signs up | OTP → details → KYC queue → admin approval; can browse, cannot order until approved | ✅ |
| Wrong or fake GSTIN | Format + checksum validation; admin asks for changes | ✅ |
| Drug licence missing or expired | Missing → blocked approval ✅. Expiry dates stored; **auto-block ordering on expiry + reminders 30/7/1 days before** | 🟡 ⏳ P2 |
| Shop staff tries to place an order | Blocked; can add to cart and shortage list | ✅ |
| Owner leaves or shop is sold | Admin transfers ownership; old owner suspended; history kept | ⏳ P2 |
| Employee leaves | Suspend → logged out of all devices immediately | ✅ (pending upload) |
| Shop wants a new distributor | Link request → distributor sets party code and credit | ✅ |
| Distributor declines | Shop notified; can re-request after 30 days | 🟡 notify ✅ · cool-off ⏳ |
| Distributor leaves the platform | Links frozen, open orders completed or cancelled with notice, data retained per law | ⏳ P3 |

### 5.2 Ordering
| Scenario | Handling | Status |
|---|---|---|
| Stock changes between viewing and ordering | Re-checked inside the order transaction; clear message to switch distributor | ✅ |
| Price or scheme changes while the item is in the cart | Cart shows the current price; if it changed since added, a "price updated" badge before placing | ⏳ P2 |
| Scheme expires mid-cart | Same as above; free quantity recalculated | ⏳ P2 |
| Over credit limit | Blocked per distributor; suggest moving items or paying dues | ✅ |
| Two phones in the same shop order at once | Credit rows locked; second order sees the updated credit | ✅ |
| Double tap / network retry on Place order | **Idempotency key**: the repeat returns the first result, no duplicate | ⏳ next |
| Out of stock everywhere | Same-salt substitutes + "tell me when back" | ✅ / notify ⏳ P3 |
| Partial supply | Billed qty recorded; "get the rest from another distributor" | ✅ |
| Distributor doesn't accept within X hours | Reminder to distributor, then escalation to admin; shop told and offered re-routing | ⏳ P2 |
| Distributor rejects | Credit released; shop told the reason; one-tap re-route | ✅ / re-route ⏳ |
| Shop cancels | Allowed only before acceptance; credit released | ✅ |
| Order to a distributor whose sync is offline | Allowed with "stock may be old" warning; distributor alerted | 🟡 alert ✅ · banner ⏳ |
| Minimum order value / delivery slot rules | Per-distributor settings | ⏳ P2 |
| Holiday / distributor closed | Calendar per distributor; orders queued with an expected date shown | ⏳ P3 |

### 5.3 Delivery, returns and money
| Scenario | Handling | Status |
|---|---|---|
| Short or damaged goods on delivery | Shop marks received with exceptions + photo → claim to distributor → credit note | ⏳ P3 |
| Wrong item delivered | Return request linked to order line | ⏳ P3 |
| Expiry returns | Near-expiry list, return claim, credit note tracking | ⏳ P3 |
| Invoice differs from order | Billed qty/rate from ERP shown side-by-side; mismatch flagged | 🟡 billed qty ✅ |
| Payment fails or is pending (UPI) | Payment intent → webhook confirmation → **daily reconciliation** with Razorpay; never mark paid on client say-so | ⏳ P4 |
| Partial payment / overpayment | Allocated against oldest bills; excess kept as advance | ⏳ P4 |
| Dues dispute | Ledger from ERP + payments; dispute ticket with documents | ⏳ P4 |
| ERP dues and MediLink dues differ | ERP is the source of truth for dues; daily sync + difference report | 🟡 sync ✅ · report ⏳ |

### 5.4 Regulatory (India)
| Scenario | Handling | Status |
|---|---|---|
| Only licensed shops may buy | KYC with drug licences before ordering | ✅ |
| Schedule H/H1 drugs | Marked on screens ✅; H1 sale register export for shops | 🟡 ⏳ P3 |
| Schedule X / narcotic (NDPS) drugs | **Not orderable on the platform**; blocked at catalogue level | ⏳ P2 |
| Banned drug (govt notification) or batch recall | Admin marks product/batch banned → ordering blocked instantly → shops that bought that batch notified | ⏳ P2 |
| GST rate change | GST % per product with effective date; orders keep the rate at time of order | 🟡 per-product ✅ · dated ⏳ |
| MRP change | Versioned; invoices keep the MRP at time of billing | ⏳ P2 |
| SMS rules (DLT) | Registered templates only | ⏳ P4 |
| Data protection (DPDP Act) | Consent recorded ✅; data export and deletion requests; deletion respects tax retention (anonymise, keep invoices) | 🟡 ⏳ P4 |
| Tax record retention | Orders/invoices kept ≈ 8 years (GST law); never hard-deleted | ✅ by design |

## 6. Technical failure scenarios

| Scenario | What the user sees | What the system does | Status |
|---|---|---|---|
| Planned maintenance | "Upgrading, back by 11:30 pm. Your cart is saved." | Maintenance mode from admin; auto-reopens | ⏳ next |
| API crashes | Caddy fallback page: "Technical problem, back in a few minutes" | Container auto-restarts; alert sent | ⏳ deploy pkg |
| Whole server down | App shows built-in "We'll be back" screen + status page link | Status page on a separate machine; alert; restore runbook | ⏳ deploy pkg |
| Database down | Fallback page | Auto-restart; if the disk failed, restore from backup (RTO ≤ 1 h) | ⏳ deploy pkg |
| Disk full | — (prevented) | Alert at 70% and 85%; log rotation; backups off-server | ⏳ deploy pkg |
| Bug on one screen | "Something went wrong. [Try again] · Ref ML-7F3K2" | Error boundary; error logged with reference | ⏳ next |
| One action fails | Clear reason + "your cart is saved" + retry | Transaction rolled back; safe retry via idempotency | 🟡 rollback ✅ |
| Slow server | "Still working…" after 5 s; timeout at 30 s with retry | Request timeouts; slow-query log | ⏳ next |
| User's internet off | "You're offline" (different from "we are down") | Connectivity check vs health check | ⏳ next |
| Old app version | "Please update to continue" | Minimum version setting | ⏳ next |
| SMS provider down | OTP via WhatsApp or second SMS provider | Provider failover | ⏳ P4 |
| WhatsApp / push down | Messages retried; failed list in admin for resend | Outbox retries + dead-letter list | 🟡 outbox ✅ |
| Payment gateway down | "UPI unavailable, pay later from Account" | Order flow does not depend on payment | ⏳ P4 |
| Sync agent offline / PC off | Shops see "stock updated 2 h ago" | Heartbeat monitor + distributor alert | 🟡 |
| Agent sends same bill twice | Second one ignored safely | Status rules reject duplicate billing | ✅ |
| Agent clock wrong | Requests rejected with a clear message on the PC | Timestamp check | ✅ |
| HTTPS certificate expiry | — | Caddy auto-renews; monitor alerts 14 days before | ⏳ deploy pkg |
| Domain expiry | — | Auto-renew + calendar alert | ⏳ ops |
| Time zones | All times stored UTC, shown IST | ✅ |

## 7. Release and change scenarios

| Scenario | Handling | Status |
|---|---|---|
| Bad code reaches main | Blocked by automated checks (tests, type checks, builds) | ✅ |
| Bad release reaches production | Versioned images; **one-command rollback (~1 min)**; auto-rollback if health check fails | ⏳ deploy pkg |
| Database change fails | Automatic backup before every migration; two-step (expand → contract) changes so rollback never breaks data | 🟡 migrations ✅ |
| Wrong setting changed | Settings are versioned and audited; revert from history | ⏳ P2 |
| Secret leaked (key, password) | Rotate in one place; old tokens invalidated; audit review | 🟡 |
| App store rejects an update | Web keeps working; over-the-air fix via Expo updates for JS-only issues | ⏳ P3 |

## 8. Security scenarios

| Threat | Protection | Status |
|---|---|---|
| OTP guessing | 5 tries per code, 3 codes per 10 min, codes hashed, 5-min expiry | ✅ |
| Stolen refresh token | Rotation + reuse detection logs the user out everywhere | ✅ |
| Lost or stolen phone | Admin/owner "log out everywhere"; optional fingerprint/Face ID to open the app | 🟡 ✅ logout · ⏳ biometric P3 |
| SIM swap | New device login notifies other devices; sensitive actions (payments, bank) re-confirm | ⏳ P4 |
| One shop seeing another's data | Ownership checks ✅ + row-level security ⏳ | 🟡 |
| Insider/admin misuse | Roles, append-only audit, **two-person approval** for credit-limit increases and bulk deletes | 🟡 ⏳ P3 |
| Competitors scraping prices | Prices only for linked, approved shops; rate limits; bot detection on search | 🟡 |
| Injection attacks | Parameterised queries only; input validation on every endpoint | ✅ |
| DDoS | Caddy rate limits; cloud firewall; can add a free CDN | ⏳ deploy pkg |
| Tampered sync data | HMAC signatures + timestamp | ✅ |
| Admin account takeover | Admin 2-step login (authenticator app); IP allow-list option | ⏳ P2 |

## 9. Scale and performance scenarios

| Scenario | Handling | Status |
|---|---|---|
| Festival or season peak (10× orders) | Stateless API → run more copies behind Caddy; DB connection pooling | ⏳ deploy pkg |
| Search slows with 1 lakh products | Trigram index ✅; result caching; pagination | 🟡 |
| Big distributor syncs 50k items | Batches of 2,000 ✅; background processing | 🟡 |
| Reports slow down ordering | Reports run on a read replica | ⏳ P4 |
| Growth beyond one city | Region, city and pincode reference data; per-region settings | ⏳ P2 |
| Load testing before launch | JMeter: 500 shops ordering in 10 minutes; search under 300 ms | ⏳ P5 |

## 10. Backup and disaster recovery

| Item | Design |
|---|---|
| Database | pgBackRest: continuous change archiving + nightly full backup, encrypted, stored in another region |
| Files (KYC documents) | restic, encrypted, daily |
| Retention | 7 daily · 4 weekly · 12 monthly; invoices/orders kept ≈ 8 years in the live database |
| Targets | **Data loss ≤ 5 minutes (RPO) · back online ≤ 1 hour (RTO)** |
| Restore to a moment | Point-in-time recovery ("before the bad import at 10:42") |
| Proof | Automated **monthly restore test** on a scratch server, alert if it fails |
| Runbooks | Written step-by-step: server lost · database corrupted · bad import · bad release · key leaked |

## 11. Operations

| Area | Design |
|---|---|
| Monitoring | Uptime Kuma checks web, API, DB and certificate every minute → WhatsApp/Telegram/email alerts |
| Status page | Public Uptime Kuma status page on a separate machine |
| Logs | Structured logs with request IDs (the reference shown to users) |
| Daily health report | Failed messages, sync-offline distributors, stuck orders, reconciliation differences |
| Incident process | Detect → status page update → fix or rollback → root-cause note within 48 h |
| Support | Users quote the reference code; support finds the exact request in seconds |

## 12. Testing strategy

| Level | What | Status |
|---|---|---|
| Business rules | Unit tests for pricing, best price, search, list reading, validation, roles | ✅ 21 tests |
| Sync agent | Full cycle against a signature-checking fake API | ✅ |
| API end-to-end | OTP → search → cart → order → accept → bill → access checks; users & access | ✅ (one fix pending upload) |
| Database | Migrations + seed on a fresh PostgreSQL every change | ✅ |
| Web + mobile | Type checks + production build every change | ✅ |
| Failure drills | Kill API, kill DB, restore backup, roll back a release (quarterly) | ⏳ P5 |
| Load | JMeter peak tests | ⏳ P5 |
| Usability | 5 shop owners + 3 distributor staff before launch | ⏳ |

## 13. Build order

1. Upload the pending test fix (rate limit off in tests)
2. **Friendly failure screens:** error boundary + reference codes, offline vs down, maintenance mode, minimum app version, timeouts
3. **Duplicate-order protection** (idempotency keys)
4. **Data model upgrade:** reference tables, aliases, barcodes, packs, batches, price lists, schemes, custom fields, soft delete, history, banned/recalled products, licence expiry blocking, row-level security
5. **Import Hub** with templates, preview and undo
6. **Deployment package:** Caddy (HTTPS + fallback page), pgBackRest, restic, Uptime Kuma + status page, one-command install, rollback, monitoring
7. Then Phases 3–5 from the build prompt (returns, payments, WhatsApp ordering, ERP adapters, sales-rep app, load tests)
