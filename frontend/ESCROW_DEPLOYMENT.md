# SettleFlow Escrow Testing Setup

## Updated Structure

```text
frontend/
  app/
    invoice/[shareToken]/page.jsx
    track/[token]/page.jsx
  components/
    PublicInvoiceTracker.jsx
  lib/
    supabaseClient.js
    useInvoiceRealtime.js
    types/escrow.ts
  supabase/
    escrow-protected-invoices.sql
program/
  Anchor.toml
  programs/settleflow_escrow/
    Cargo.toml
    src/lib.rs
```

## Supabase

Run these SQL files in Supabase SQL Editor:

1. `frontend/supabase/schema.sql`
2. `frontend/supabase/escrow-protected-invoices.sql`

The escrow schema creates `users`, `invoices`, `escrow_transactions`, and `invoice_events`, enables RLS, and adds Realtime publication entries.

## Environment Variables

Add these to Vercel and local `.env.local`:

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
STABLECOIN_MINT_ADDRESS=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
STABLECOIN_ESCROW_WALLET=
STABLECOIN_ESCROW_SECRET_KEY=
OPENAI_API_KEY=
DODO_API_KEY=
DODO_PRODUCT_ID=
DODO_WEBHOOK_KEY=
```

Only `NEXT_PUBLIC_*` values are exposed to the browser. Keep service role, escrow secret, OpenAI, Dodo, and webhook keys server-side.

## Anchor Escrow

The Anchor program now includes:

- `initialize_escrow`
- `fund_escrow`
- `release_funds`
- `dispute`

The seller wallet is stored during escrow initialization. `release_funds` validates the seller token account against the stored seller pubkey and does not accept a seller address argument.

For full on-chain testing, deploy the program to devnet, create a PDA-owned escrow token account for each invoice, then wire the frontend transaction builder to call the program instructions instead of the current direct SPL escrow-wallet flow.

## Run

```bash
npm install
npm run build
npm start
```

Public invoice links use:

```text
/invoice/[shareToken]
```
