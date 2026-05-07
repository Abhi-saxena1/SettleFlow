export type EscrowInvoiceStatus =
  | "draft"
  | "checkout_pending"
  | "fiat_paid"
  | "treasury_funding_pending"
  | "escrow_funded"
  | "work_submitted"
  | "release_pending"
  | "released"
  | "withdrawn"
  | "refunded"
  | "disputed";

export type EscrowTransactionStatus =
  | "draft"
  | "checkout_pending"
  | "fiat_paid"
  | "treasury_funding_pending"
  | "escrow_funded"
  | "work_submitted"
  | "release_pending"
  | "released"
  | "withdrawn"
  | "refunded"
  | "failed"
  | "disputed";

export type EscrowMilestone = {
  id: string;
  title: string;
  amount: number;
  status: "draft" | "escrow_funded" | "released" | "withdrawn" | "disputed";
};

export type EscrowInvoice = {
  id: string;
  share_token: string;
  seller_id: string | null;
  title: string;
  description: string | null;
  client_name: string | null;
  client_email: string | null;
  amount: number;
  funded_amount: number;
  seller_wallet: string | null;
  due_date: string | null;
  allow_partial_funding: boolean;
  milestones: EscrowMilestone[];
  status: EscrowInvoiceStatus;
  escrow_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type EscrowTransaction = {
  id: string;
  invoice_id: string;
  buyer_wallet: string | null;
  seller_wallet: string | null;
  escrow_account: string | null;
  transaction_signature: string | null;
  status: EscrowTransactionStatus;
  created_at: string;
};

export type InvoiceEvent = {
  id: string;
  invoice_id: string;
  event_type: string;
  description: string;
  created_at: string;
};

export type SellerPayoutStatus =
  | "draft"
  | "checkout_pending"
  | "fiat_paid"
  | "treasury_funding_pending"
  | "escrow_funded"
  | "work_submitted"
  | "release_pending"
  | "released"
  | "withdrawn"
  | "refunded"
  | "disputed"
  | "failed";

export type SellerPayout = {
  id: string;
  invoice_id: string;
  seller_name: string | null;
  seller_email: string | null;
  amount: number;
  currency: string;
  provider: "anchor_usdc";
  status: SellerPayoutStatus;
  reference: string | null;
  note: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};
