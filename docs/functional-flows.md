# MediLink — Functional Flow Sequences

Each flow shows who does what, in order. ✅ built · ⏳ planned.

## F1. Shop registration and approval ✅
```mermaid
sequenceDiagram
  actor Owner as Shop owner
  participant App as Shop app / web
  participant API
  participant DB as Database
  actor Admin
  Owner->>App: Enter mobile number
  App->>API: Request OTP
  API->>Owner: SMS with 6-digit OTP (5 min, max 3 per 10 min)
  Owner->>App: Enter OTP
  App->>API: Verify OTP
  API-->>App: New number → registration form
  Owner->>App: Shop name, address, GSTIN, drug licences 20B/21B, accept terms
  App->>API: Register shop
  API->>API: Check GSTIN format + checksum, licences present
  API->>DB: Create shop (KYC pending) + owner account, log activity
  API-->>App: Logged in — can browse, cannot order yet
  Admin->>API: Open approvals queue
  Admin->>API: Approve / ask for changes / reject
  API->>DB: Update KYC, log activity, queue SMS/WhatsApp
  API-->>Owner: "Approved — you can order now"
```

## F2. Login and staying logged in ✅
```mermaid
sequenceDiagram
  actor User
  participant App
  participant API
  User->>App: Mobile number
  App->>API: Request OTP (rate limited)
  User->>App: OTP
  App->>API: Verify (wrong OTP logged; 5 tries max)
  API-->>App: Access token (15 min) + refresh token (30 days)
  Note over App: Phone stores refresh token in Keychain / Keystore
  App->>API: Every request with access token
  API->>API: Check user still active + current role (suspension applies at once)
  App->>API: Token expired → refresh
  API-->>App: New tokens (old one revoked; reuse = log out everywhere)
```

## F3. Search, compare and add to cart ✅
```mermaid
sequenceDiagram
  actor Shop
  participant App
  participant API
  participant DB
  Shop->>App: Type "dolo" (typos fine)
  App->>API: Search
  API->>DB: Trigram search on name + salt + company
  API->>DB: Offers from linked distributors (stock, PTR, discount, scheme, expiry, credit left)
  API->>API: Best price = in stock → full qty → fits credit → lowest net rate → fastest delivery
  API-->>App: Product cards with best price; substitutes if out everywhere
  Shop->>App: Optional: Compare → pick another distributor
  Shop->>App: Add to cart (usual quantity remembered)
  App->>API: Save cart line (server-side: same cart on phone and web)
```

## F4. Paste a WhatsApp list ✅
```mermaid
sequenceDiagram
  actor Shop
  participant App
  participant API
  Shop->>App: Paste "Dolo 650 - 20 / pan 40 x10 / azithral 5"
  App->>API: Read list
  API->>API: Split lines, read quantities, fuzzy-match each product (confidence score)
  API-->>App: Matched lines; unclear ones marked "?"; unknown ones flagged
  Shop->>App: Add all at best price
  App->>API: Add many (best distributor per item)
  API-->>App: Added N, out of stock: list
```

## F5. Place order (one order per distributor) ✅
```mermaid
sequenceDiagram
  actor Owner as Shop owner
  participant App
  participant API
  participant DB
  Owner->>App: Place orders
  App->>API: Place (with time taken + idempotency key)
  API->>DB: BEGIN transaction
  API->>DB: Lock shop's credit rows
  loop each distributor in cart
    API->>DB: Re-check link + stock
    API->>API: Totals in paise (rate after discount, free qty, GST)
    API->>DB: Check credit left ≥ total, else ROLLBACK with clear message
    API->>DB: Create order ML-xxxxx + items + "Placed" event
    API->>DB: Reserve credit, log activity, queue notification to distributor
  end
  API->>DB: Update usual quantities, clear cart
  API->>DB: COMMIT (all or nothing)
  API-->>App: Success screen: orders, total, seconds taken
```

## F6. Distributor processes the order — console ✅
```mermaid
sequenceDiagram
  actor D as Distributor staff
  participant Web as Distributor console
  participant API
  participant DB
  actor Shop
  Web->>API: Load lanes (auto-refresh 30 s)
  D->>Web: Accept (or Accept all / Reject with reason)
  Web->>API: Accept
  API->>DB: Lock order, check allowed (rules), set Accepted, event, log
  API-->>Shop: "Accepted"
  D->>Web: Create bill
  API->>DB: Billed qty = min(ordered, stock) per line; reduce stock (never below 0)
  API->>DB: Invoice SVP/26-27/0001; credit reservation → dues; part supply flagged
  API-->>Shop: "Billed" (+ "came short" if partial)
  D->>Web: Send for delivery → Mark delivered (or shop marks "Goods received")
```

## F7. Distributor processes the order — automatic via billing software ✅
```mermaid
sequenceDiagram
  participant Agent as Sync agent (distributor PC)
  participant ERP as Marg / Tally / Busy
  participant API
  loop every 60 s (backs off when offline)
    Agent->>API: Heartbeat (signed)
    Agent->>ERP: Read stock export (only if changed)
    Agent->>API: Push stock, PTR, scheme, expiry (batches of 2,000)
    Agent->>API: Get new orders
    Agent->>ERP: Write order file (atomic)
    Agent->>API: Acknowledge → order Accepted
    ERP-->>Agent: Bill file (order no, invoice no, billed qty)
    Agent->>API: Billed (archive file only after success)
    Agent->>API: Party dues (when export changes)
  end
```

## F8. Part supply → get the rest elsewhere ✅
```mermaid
sequenceDiagram
  actor Shop
  participant App
  participant API
  API-->>Shop: "Came short: Montair LC 4 of 10"
  Shop->>App: Get the rest from another distributor
  App->>API: Get rest (exclude original distributor)
  API->>API: Best price for the missing quantity only
  API-->>App: Added to cart → Place orders (F5)
```

## F9. Shop links a new distributor ✅
```mermaid
sequenceDiagram
  actor Shop
  actor D as Distributor admin
  participant API
  Shop->>API: Request to link
  API-->>D: New link request (notification + console card)
  D->>API: Approve with party code + credit limit (or decline)
  API-->>Shop: Linked — that distributor's prices now appear in search
```

## F10. Shortage list (staff → owner) ✅
```mermaid
sequenceDiagram
  actor Staff as Shop staff
  actor Owner
  participant API
  Staff->>API: Save item to shortage list (cannot place orders)
  Owner->>API: Order all at best price
  API-->>Owner: Items in cart; still-out-of-stock items stay on the list
```

## F11. User access management ✅
```mermaid
sequenceDiagram
  actor Admin
  participant API
  participant DB
  actor User
  Admin->>API: Users & access → search user
  API-->>Admin: Role in plain words, devices, recent activity
  Admin->>API: Suspend (reason required)
  API->>DB: Status suspended, revoke all sessions, log activity
  User->>API: Next request
  API-->>User: "Account suspended. Please call support."
  Admin->>API: Re-activate / log out everywhere / change role (super admin)
```

## F12. Import data with undo ⏳
```mermaid
sequenceDiagram
  actor Admin
  participant Hub as Import Hub
  participant DB
  Admin->>Hub: Upload Excel/CSV (or sync agent / API)
  Hub->>Admin: Map columns (saved template per source)
  Hub->>Hub: Validate every row (required, GSTIN, duplicates, prices)
  Hub-->>Admin: Preview: 1,240 new · 380 updated · 12 errors (row numbers)
  Admin->>Hub: Commit (or fix and re-upload)
  Hub->>DB: Save as batch #57 in one transaction; keep old values
  Admin->>Hub: Undo batch #57 (if needed)
  Hub->>DB: Restore previous values, log activity
```

## F13. System down / maintenance — what users see ✅
```mermaid
sequenceDiagram
  actor User
  participant App
  participant Caddy as Web server (Caddy)
  participant API
  participant Status as Status page (separate machine)
  User->>App: Open MediLink
  App->>Caddy: Request
  alt Maintenance mode on
    Caddy->>API: Request
    API-->>App: 503 + message + "back by 11:30 pm"
    App-->>User: Maintenance screen (auto-retry 30 s, cart saved)
  else API not answering
    Caddy-->>App: Built-in fallback page
    App-->>User: "Technical problem — back in a few minutes" + status page link
  else User's internet off
    App-->>User: "You're offline — check your internet"
  else Screen error
    App-->>User: "Something went wrong · Ref ML-7F3K2 · Try again"
  end
  Status-->>User: Live status and updates
```

## F14. Bad release → rollback ✅
```mermaid
sequenceDiagram
  participant CI as GitHub checks
  participant Server
  participant Backup as Backups
  actor Ops
  CI->>CI: Tests + builds must pass
  Server->>Backup: Backup before database change
  Server->>Server: Deploy version N+1, health check
  alt Health check fails
    Server->>Server: Auto-rollback to version N
  else Problem found later
    Ops->>Server: rollback (one command, ~1 min)
  end
```

## F15. Disaster recovery ✅
```mermaid
sequenceDiagram
  participant DB as Database server
  participant Store as Off-site backup storage
  actor Ops
  loop continuously
    DB->>Store: Change log every few minutes (encrypted)
  end
  DB->>Store: Nightly full backup
  Note over DB: Server or disk lost
  Ops->>Store: Restore to new server, to any minute
  Ops->>Ops: Health checks, status page "restored"
  Note over Ops,Store: Monthly automatic restore test proves backups work
```

## F16. Payment of dues by UPI ⏳ (Phase 4)
```mermaid
sequenceDiagram
  actor Shop
  participant App
  participant API
  participant PG as Razorpay
  Shop->>App: Pay ₹62,000 to Sri Venkateswara
  App->>API: Create payment (idempotency key)
  API->>PG: Create order
  App->>PG: UPI payment
  PG->>API: Webhook (signed) → mark paid, reduce dues
  Note over API,PG: Never trust the phone's "success" alone; daily reconciliation
```

## F17. Admin login with 2-step verification ✅
```mermaid
sequenceDiagram
  actor Admin
  participant Web as Admin web
  participant API
  participant Phone as Authenticator app
  Admin->>Web: Mobile number → SMS OTP
  Web->>API: Verify OTP
  alt 2-step login already on
    API-->>Web: "Code from your authenticator app" (5-min login ticket, no session yet)
    Admin->>Phone: Read 6-digit code
    Admin->>Web: Code (or a one-time recovery code)
    Web->>API: Verify code (one use per code; 5 wrong tries → 10-min pause)
    API-->>Web: Session marked "2-step passed"
  else Not set up and required (always on a live system)
    API-->>Web: Session limited to the setup screen
    Web->>API: Start setup → QR code
    Admin->>Phone: Scan QR
    Admin->>Web: First code
    API->>API: Turn on, end older sessions, make 10 recovery codes
    API-->>Web: Recovery codes (shown once) + full session
  end
  Note over API: Optional office IP allow-list checked on every admin request
  Note over API: Lost phone → super admin resets 2-step login (logged)
```

## F18. Every shop and distributor request is fenced by the database ✅
```mermaid
sequenceDiagram
  participant App as Shop / distributor app
  participant API
  participant DB as PostgreSQL
  App->>API: Request with login token
  API->>DB: BEGIN; SET LOCAL ROLE medilink_tenant; set shop / distributor id
  API->>DB: The request's queries
  DB-->>API: Only this business's orders, carts, links, dues (others invisible; writing them is refused)
  API->>DB: COMMIT (or ROLLBACK on any error)
  API-->>App: Answer
```
