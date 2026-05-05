<<<<<<< HEAD
# SettleFlow

SettleFlow is a hackathon-friendly MVP for programmable B2B payments. It lets SMEs create invoices, simulate escrow funding and payment release, and run AI-assisted transaction risk scoring.

## Folder Structure

```text
settleflow-mvp/
  backend/
    data/
      invoices.json
    src/
      db.js
      index.js
      risk.js
    .env.example
    package.json
  frontend/
    app/
      dashboard/
        page.jsx
      globals.css
      layout.jsx
      page.jsx
    components/
      AiRiskCard.jsx
      CTASection.jsx
      DashboardPreview.jsx
      FeatureCard.jsx
      FeaturesSection.jsx
      HeroSection.jsx
      InvoiceForm.jsx
      InvoiceTable.jsx
      Navbar.jsx
      TrustSection.jsx
    lib/
      api.js
    package.json
    postcss.config.js
    tailwind.config.js
  program/
    Anchor.toml
    programs/
      settleflow_escrow/
        Cargo.toml
        src/
          lib.rs
```

## Run Locally

1. Install dependencies:

```bash
npm run install:all
```

2. Create backend environment:

```bash
cp backend/.env.example backend/.env
```

Add `OPENAI_API_KEY` if you want live AI scoring. Without it, the backend uses a deterministic mock risk score.

3. Start both apps:

```bash
npm run dev
```

Frontend: http://localhost:3000

Backend: http://localhost:4000

## API Endpoints

- `POST /invoice/create`
- `GET /invoice/all`
- `POST /invoice/checkout`
- `POST /invoice/payment/sync`
- `POST /invoice/fund`
- `POST /invoice/release`
- `POST /stablecoin/fund`
- `POST /stablecoin/release`
- `POST /ai/risk`
- `POST /dodo/webhook`

## Dodo Payments

SettleFlow uses Dodo Payments Checkout Sessions as the core hosted payment layer for invoice payment collection. Checkout creation is intentionally real-only: the backend returns a configuration error until your Dodo API key and product ID are present.

Add these values to `backend/.env` for live test-mode sessions:

```bash
DODO_PAYMENTS_API_KEY=your-api-key
DODO_PAYMENTS_WEBHOOK_KEY=your-webhook-secret
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_PRODUCT_ID=your-dodo-product-id
DODO_PAYMENTS_RETURN_URL=http://localhost:3000/dashboard
DODO_PAYMENTS_CURRENCY=USD
DODO_PAYMENTS_USE_INVOICE_AMOUNT=true
```

Important Dodo setup:

- Create a one-time product in the Dodo dashboard and copy its product ID.
- If `DODO_PAYMENTS_USE_INVOICE_AMOUNT=true`, configure that product for dynamic / pay-what-you-want style pricing so the invoice amount can be sent in `product_cart.amount`.
- Keep `DODO_PAYMENTS_ENVIRONMENT=test_mode` while testing.
- Configure your webhook URL as `POST /dodo/webhook` and set the signing key in `DODO_PAYMENTS_WEBHOOK_KEY`.

## Solana USDC Escrow

SettleFlow includes a real Solana SPL-token USDC settlement rail:

```bash
STABLECOIN_CHAIN=solana-devnet
STABLECOIN_SYMBOL=USDC
STABLECOIN_MINT_ADDRESS=your-devnet-usdc-mint
STABLECOIN_ESCROW_WALLET=escrow-wallet-public-key
STABLECOIN_ESCROW_SECRET_KEY=[1,2,3,...]
STABLECOIN_DECIMALS=6
SOLANA_RPC_URL=https://api.devnet.solana.com
```

Dashboard invoices support:

- `Fund USDC escrow`: creates a Phantom/Solana wallet-signed SPL transfer to the escrow token account, verifies the confirmed transaction, and moves the invoice to `Funded`.
- `Release USDC`: signs a backend SPL transfer from the escrow wallet to the seller wallet and moves the invoice to `Completed`.

For production, replace the backend escrow signer with the Anchor PDA vault flow so release rules are enforced fully on-chain.
=======
# SettleFlow
>>>>>>> c5504ef4ddc7938d791dbbf69832432d84f273f3
