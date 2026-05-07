export type EscrowInvoiceStatus =
  | "created"
  | "partially_funded"
  | "fully_funded"
  | "awaiting_release"
  | "released"
  | "completed"
  | "disputed";

export type EscrowTransactionStatus =
  | "created"
  | "funded"
  | "partially_funded"
  | "released"
  | "completed"
  | "failed"
  | "disputed";

export type EscrowMilestone = {
  id: string;
  title: string;
  amount: number;
  status: "created" | "funded" | "released" | "disputed";
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
