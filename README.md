
# SettleFlow

Programmable escrow infrastructure for SMEs powered by Solana + Stablecoins.

SettleFlow is a hybrid fintech + Web3 payment infrastructure platform designed to reduce payment delays between buyers and suppliers using escrow-protected settlements, stablecoins, and Solana smart contracts.

The platform combines traditional card payments with on-chain settlement infrastructure to create transparent, programmable, and milestone-based business payments.

Overview

Small and medium businesses frequently face:

1.delayed invoice settlements
2.payment disputes
3.lack of transparency
4.expensive cross-border transfers
5.trust issues between buyers and suppliers

SettleFlow introduces programmable escrow infrastructure where funds can be securely locked, tracked, and released through smart contract logic.
## Status

MVP currently running on Solana Devnet for testing and development purposes.

Core Features
-Escrow-protected settlements
-Stablecoin-based payment rails
-Milestone-based payouts
-Solana Anchor smart contracts
-Transparent on-chain tracking
-Treasury funding system
-Seller withdrawal flow
-Devnet testing support
-Card payment integration
-AI-assisted transaction risk scoring


## Payment Architecture
Buyer Card Payment
        ↓
Dodo Payments
        ↓
Treasury Wallet
        ↓
Anchor Escrow Program
        ↓
Seller Withdrawal

Card payments are processed through Dodo Payments and converted into on-chain USDC settlements on Solana.

Funds are routed through a treasury layer before interacting with the escrow smart contract.



## Product Workflow
1. Invoice Creation

Businesses create invoices and define payment milestones.

2. Buyer Funding

The buyer funds the invoice using card payments.

3. Treasury Settlement

Funds are converted into on-chain USDC and routed to the treasury layer.

4. Escrow Locking

Funds are locked inside the Solana Anchor escrow program.

5. Milestone Release

Payments are released based on milestone completion.

6. Seller Withdrawal

The seller withdraws settled funds securely.

## Tech Stack
-Frontend
-Next.js
-TypeScript
-TailwindCSS
-Backend
-Node.js
-Supabase
-PostgreSQL
-Blockchain
-Solana
-Anchor Framework
-SPL Tokens
-Phantom Wallet
-Payments
-Dodo Payments
-USDC Stablecoin

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

## Dodo Payments Integration

SettleFlow uses Dodo Payments Checkout Sessions for invoice payment collection.

Required Setup
-Create a one-time product in the Dodo dashboard
-Copy the product ID into your environment variables
-Keep the environment in test_mode while testing
-Configure the webhook endpoint:
-POST /dodo/webhook


## Smart Contract

The escrow infrastructure is powered by Solana Anchor programs.

The contract handles:

-escrow creation
-fund locking
-milestone release
-withdrawal validation
-settlement tracking


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
STABLECOIN_ESCROW_SECRET_KEY=
STABLECOIN_DECIMALS=6
SOLANA_RPC_URL=https://api.devnet.solana.com


```
Required private environment variables:

- Treasury wallet signer
- Supabase service role key
- Dodo API credentials
- Webhook signing secret


## Vision
SettleFlow aims to build programmable payment infrastructure for global SMEs using stablecoins and smart contract escrow.

The goal is to make business settlements:

1.instant
2.transparent
3.programmable
4.globally accessible

# License

MIT License

# SettleFlow

