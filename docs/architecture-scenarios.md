# MediLink — Architecture & Scenario Handbook

Version 1.1 · 24 Oct 2026 · Owner: Architecture

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
| Custom fields | JSON "extra details" column on product, shop and distributor, plus a **Field definitions** table (name, type, required, where shown); new fields need no code (Admin › Data fields; values checked; hiding a field keeps its values) | ✅ |
| Product identity | One master product · **aliases** (names used by distributors and shops) · **barcodes** table (many per product) · pack/unit conversion (strip ↔ box) | 🟡 master + mapping + aliases (incl. Telugu/Hindi script) + many barcodes ✅ · pack conversion ⏳ part 2 |
| Stock | Per distributor item, plus **batches** (batch no, expiry, qty) | ✅ batches from billing software; nearest expiry kept by the database |
| Pricing | **Price lists** (per distributor, per shop group, valid from/to) and **schemes** (free qty, % off, ₹ off, valid from/to, targeted) | 🟡 single PTR + scheme ✅ · lists ⏳ part 2 |
| History | **Versioned** price, credit-limit and product changes ("what was the rate on 12 Oct?"): written by database triggers with the admin's name, append-only | ✅ |
| Deletion | **Soft delete** with restore; hard delete only for legal erasure requests | 🟡 medicines never deleted (status Discontinued) ✅ · general restore ⏳ part 2 |
| Tenant isolation | Ownership checks in every query ✅ + PostgreSQL row-level security: shop and distributor requests run as a restricted database role in one transaction, so other businesses' orders, carts, links, dues and stock writes are invisible or refused even if a query forgets its filter | ✅ |
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
| Drug licence missing or expired | Missing → blocked approval ✅. Expiry dates stored; **auto-block ordering on expiry + warning 30 days before**; admin records renewals; expired distributors drop out of offers | ✅ (SMS reminders 30/7/1 ⏳ P4) |
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
| Double tap / network retry on Place order | **Idempotency key** (web + phone): the repeat returns the first result, no duplicate | ✅ |
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
| Schedule X / narcotic (NDPS) drugs | **Not orderable on the platform**: hidden from offers and substitutes, refused in cart and orders, and refused by a database trigger; marking a medicine Schedule X / narcotic removes it from every cart at once | ✅ |
| Banned drug (govt notification) or batch recall | Admin marks product/batch banned → ordering blocked instantly, shops see the note and same-salt alternatives, distributors with open orders alerted | ✅ product level · batch-level recall ⏳ part 2 |
| GST rate change | GST % per product with effective date; orders keep the rate at time of order | 🟡 per-product ✅ · dated ⏳ |
| MRP change | Versioned; invoices keep the MRP at time of billing | ⏳ P2 |
| SMS rules (DLT) | Registered templates only | ⏳ P4 |
| Data protection (DPDP Act) | Consent recorded ✅; data export and deletion requests; deletion respects tax retention (anonymise, keep invoices) | 🟡 ⏳ P4 |
| Tax record retention | Orders/invoices kept ≈ 8 years (GST law); never hard-deleted | ✅ by design |

## 6. Technical failure scenarios

| Scenario | What the user sees | What the system does | Status |
|---|---|---|---|
| Planned maintenance | "Upgrading, back by 11:30 pm. Your cart is saved." | Admin › Settings switch with message + return time; screens re-check every 30 s and reopen by themselves | ✅ |
| API crashes | Caddy fallback page: "Technical problem, back in a few minutes" | Container auto-restarts; alert sent | ✅ |
| Whole server down | App shows built-in "We'll be back" screen + status page link | Status page on a separate machine; alert; restore runbook | ✅ (status machine set up by hand once) |
| Database down | Fallback page | Auto-restart; if the disk failed, restore from backup (RTO ≤ 1 h) | ✅ |
| Disk full | — (prevented) | Alert at 70% and 85%; log rotation; backups off-server | ✅ |
| Bug on one screen | "Something went wrong. [Try again] · Ref ML-7F3K2" | Error boundary on web and phone; error logged with reference | ✅ |
| One action fails | Clear reason + "your cart is saved" + retry | Transaction rolled back; safe retry via idempotency | ✅ |
| Slow server | "Still working…" after 5 s; timeout at 30 s with retry | Request timeouts (30 s) + "Still working…" bar; slow-query log ⏳ | 🟡 screens ✅ |
| User's internet off | "You're offline" (different from "we are down") | Connectivity check vs health check | ✅ |
| Old app version | "Please update to continue" | Minimum version setting in Admin › Settings; phone sends its version | ✅ |
| SMS provider down | OTP via WhatsApp or second SMS provider | Provider failover | ⏳ P4 |
| WhatsApp / push down | Messages retried; failed list in admin for resend | Outbox retries + dead-letter list | 🟡 outbox ✅ |
| Payment gateway down | "UPI unavailable, pay later from Account" | Order flow does not depend on payment | ⏳ P4 |
| Sync agent offline / PC off | Shops see "stock updated 2 h ago" | Heartbeat monitor + distributor alert | 🟡 |
| Agent sends same bill twice | Second one ignored safely | Status rules reject duplicate billing | ✅ |
| Agent clock wrong | Requests rejected with a clear message on the PC | Timestamp check | ✅ |
| HTTPS certificate expiry | — | Caddy auto-renews; monitor alerts 14 days before | ✅ |
| Domain expiry | — | Auto-renew + calendar alert | ⏳ ops |
| Time zones | All times stored UTC, shown IST | ✅ |

## 7. Release and change scenarios

| Scenario | Handling | Status |
|---|---|---|
| Bad code reaches main | Blocked by automated checks (tests, type checks, builds) | ✅ |
| Bad release reaches production | Versioned images; **one-command rollback (~1 min)**; auto-rollback if health check fails | ✅ drilled on every pull request |
| Database change fails | Automatic backup before every migration; two-step (expand → contract) changes so rollback never breaks data | ✅ (rule in runbooks) |
| Wrong setting changed | Settings are versioned and audited; revert from history | ⏳ P2 |
| Secret leaked (key, password) | Rotate in one place; old tokens invalidated; audit review | ✅ runbook 7 |
| App store rejects an update | Web keeps working; over-the-air fix via Expo updates for JS-only issues | ⏳ P3 |

## 8. Security scenarios

| Threat | Protection | Status |
|---|---|---|
| OTP guessing | 5 tries per code, 3 codes per 10 min, codes hashed, 5-min expiry | ✅ |
| Stolen refresh token | Rotation + reuse detection logs the user out everywhere | ✅ |
| Lost or stolen phone | Admin/owner "log out everywhere"; optional fingerprint/Face ID to open the app | 🟡 ✅ logout · ⏳ biometric P3 |
| SIM swap | New device login notifies other devices; sensitive actions (payments, bank) re-confirm | ⏳ P4 |
| One shop seeing another's data | Ownership checks + PostgreSQL row-level security | ✅ |
| Insider/admin misuse | Roles, append-only audit, **two-person approval** for credit-limit increases and bulk deletes | 🟡 ⏳ P3 |
| Competitors scraping prices | Prices only for linked, approved shops; rate limits; bot detection on search | 🟡 |
| Injection attacks | Parameterised queries only; input validation on every endpoint | ✅ |
| DDoS | Caddy rate limits (per address, stricter for login codes); cloud firewall; can add a free CDN | ✅ rate limits · CDN optional |
| Tampered sync data | HMAC signatures + timestamp | ✅ |
| Admin account takeover | Admin 2-step login (authenticator app, encrypted secrets, one-use codes, 10 recovery codes, reset by super admin; always required on a live system); optional admin IP allow-list that cannot lock out its author | ✅ |

## 9. Scale and performance scenarios

| Scenario | Handling | Status |
|---|---|---|
| Festival or season peak (10× orders) | Stateless API → run more copies behind Caddy; DB connection pooling | 🟡 pooling ✅ · extra copies when needed |
| Search slows with 1 lakh products | Trigram index ✅; result caching; pagination | 🟡 |
| Big distributor syncs 50k items | Batches of 2,000 ✅; background processing | 🟡 |
| Reports slow down ordering | Reports run on a read replica | ⏳ P4 |
| Growth beyond one city | Region, city and pincode reference data; per-region settings | ⏳ P2 |
| Load testing before launch | JMeter: 500 shops ordering in 10 minutes; search under 300 ms | ⏳ P5 |

## 10. Backup and disaster recovery

| Item | Design |
|---|---|
| Database | pgBackRest: continuous change archiving (≤ 5 min), weekly full + daily differential backups, on the server and encrypted off-site (any S3-compatible storage) |
| Files (KYC documents) | restic, encrypted, daily |
| Retention | Database: 2 weeks on the server, 90 days off-site (setting), any minute restorable in that window · Files: 7 daily · 4 weekly · 12 monthly · invoices/orders kept ≈ 8 years in the live database |
| Targets | **Data loss ≤ 5 minutes (RPO) · back online ≤ 1 hour (RTO)** |
| Restore to a moment | Point-in-time recovery ("before the bad import at 10:42") |
| Proof | Automated **monthly restore test** into a scratch database, alert if it fails ✅ |
| Runbooks | Written step-by-step (`docs/runbooks.md`): bad release · API crash · undo a mistake · database corrupted · server lost · disk full · key leaked · certificate · sync agent offline · SMS ✅ |

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
| Business rules | Unit tests for pricing, best price, search, list reading, validation, roles, controlled medicines | ✅ 26 tests |
| Sync agent | Full cycle against a signature-checking fake API | ✅ |
| API end-to-end | OTP → search → cart → order → accept → bill → access checks; users & access; Schedule X blocking; row-level security; admin 2-step login | ✅ 17 scenarios |
| Database | Migrations + seed on a fresh PostgreSQL every change | ✅ |
| Web + mobile | Type checks + production build every change | ✅ |
| Failure drills | App down page, backup, restore test, point-in-time restore, deploy, broken-release auto-rollback, manual rollback: automated on every pull request (`Production package` workflow) | ✅ |
| Load | JMeter peak tests | ⏳ P5 |
| Usability | 5 shop owners + 3 distributor staff before launch | ⏳ |

## 13. Known gaps found in review
| Gap | Fix | When |
|---|---|---|
| Some small labels stay in English on Telugu/Hindi screens (tile subtitles, "Latest order", "items") | Shop home labels done; automated check that no screen text is hard-coded | 🟡 |
| UI screenshots and design book | Regenerated automatically from the real app (`Screenshots` workflow + `tools/design-book`) | ✅ |

## 14. Build order

1. ~~Upload the pending test fix~~ ✅
2. ✅ **Friendly failure screens:** error boundary + reference codes, offline vs down, maintenance mode, minimum app version, timeouts
3. ✅ **Duplicate-order protection** (idempotency keys)
4. 🟡 **Data model upgrade:** part 1 ✅ aliases, barcodes, batches, custom fields, history, banned/recalled products, licence expiry blocking · ✅ row-level security · part 2 ⏳ reference tables, packs, price lists, schemes, general soft delete/restore, batch-level recall
5. ✅ **Launch blockers:** Schedule X / narcotic blocking, admin 2-step login + IP allow-list, row-level security
6. ✅ **Deployment package:** Caddy (HTTPS + fallback page + rate limits), pgBackRest, restic, Uptime Kuma + status page, one-command install, deploy with auto-rollback, rollback, monitoring, monthly restore test, runbooks
7. **Marg adapter** (needs sample export files from a real Marg install)
8. **Import Hub** with templates, preview and undo
9. Then Phases 3–5 from the build prompt (returns, payments, WhatsApp ordering, ERP adapters, sales-rep app, load tests)
