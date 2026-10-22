# MediLink sync agent

Runs on the distributor's billing PC. It sends stock, prices, schemes and expiry to MediLink, puts MediLink orders into the billing software, and sends bills and shop dues back. It needs only Node.js 20 or newer, with no other installs.

## Install on a Windows billing PC
1. Install Node.js 20 LTS from nodejs.org.
2. Copy this folder to `C:\MediLink\agent`.
3. Copy `config.example.json` to `config.json` and fill in:
   - `key`: the agent key from the MediLink admin panel (Admin → Distributors → Agent key). It is shown once.
   - The four CSV paths. Set up the billing software to:
     - export **stock** to `stockFile` every few minutes (Item Code, Item Name, Stock, PTR, MRP, Discount %, Scheme, Expiry, Barcode)
     - export **party outstanding** to `outstandingFile` (Party Code, Outstanding)
     - **import** sales orders from `ordersOutDir` (one CSV per MediLink order)
     - drop a CSV per **bill** into `billsInDir` (MediLink Order, Invoice No, Item Code, Billed Qty)
   - If your export uses different column names, change them under `columns`.
4. Test once: `node src\main.mjs --once`
5. Run it at start-up with Windows Task Scheduler: action `node C:\MediLink\agent\src\main.mjs`, start in `C:\MediLink\agent`, trigger "At log on", and "Restart on failure".

## How it stays safe
- Every request is signed (HMAC-SHA256 with the agent key and a timestamp). The server rejects tampered or replayed requests.
- Order files are written atomically, so the billing software never reads half a file.
- A bill file is archived only after MediLink accepts it, so an internet cut loses nothing. The agent backs off to every 5 minutes while offline.

## Billing-software notes
The CSV adapter covers Marg, Busy, GoFrugal and Tally through their CSV export and import options. Direct database adapters, such as Tally XML over port 9000 or Marg's database, are Phase 2 work and plug in next to `src/adapters/csv.mjs`.

## Tests
`node --test test/*.test.mjs` runs a full sync cycle against a fake API that checks signatures exactly like the real server.
