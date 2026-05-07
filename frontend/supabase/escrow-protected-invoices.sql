-- SettleFlow Escrow Protected Invoice schema.
-- Run in Supabase SQL Editor after the base SettleFlow schema.

create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default ('usr_' || encode(gen_random_bytes(8), 'hex')),
  settleflow_id text not null unique,
  wallet_address text,
  profile_name text,
  created_at timestamptz not null default now()
);

create table if not exists invoices (
  id text primary key,
  share_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  seller_id text references users(id) on delete set null,
  title text not null default 'Escrow protected invoice',
  description text,
  client_name text,
  client_email text,
  amount numeric(18, 6) not null check (amount >= 0),
  funded_amount numeric(18, 6) not null default 0 check (funded_amount >= 0),
  seller_wallet text,
  due_date date,
  allow_partial_funding boolean not null default true,
  milestones jsonb not null default '[]'::jsonb,
  status text not null default 'created' check (
    status in ('created', 'partially_funded', 'fully_funded', 'awaiting_release', 'released', 'completed', 'disputed')
  ),
  escrow_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists escrow_transactions (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null references invoices(id) on delete cascade,
  buyer_wallet text,
  seller_wallet text,
  escrow_account text,
  transaction_signature text,
  status text not null default 'created' check (
    status in ('created', 'funded', 'partially_funded', 'released', 'completed', 'failed', 'disputed')
  ),
  created_at timestamptz not null default now()
);

create table if not exists invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null references invoices(id) on delete cascade,
  event_type text not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists seller_payouts (
  id uuid primary key default gen_random_uuid(),
  invoice_id text not null unique references invoices(id) on delete cascade,
  seller_name text,
  seller_email text,
  amount numeric(18, 6) not null default 0,
  currency text not null default 'USDC',
  provider text not null default 'manual',
  status text not null default 'pending_platform_payout' check (
    status in ('not_started', 'pending_platform_payout', 'ready_to_pay_seller', 'seller_payout_processing', 'seller_paid', 'failed')
  ),
  reference text,
  note text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_share_token_idx on invoices(share_token);
create index if not exists invoices_seller_id_idx on invoices(seller_id);
create index if not exists escrow_transactions_invoice_id_idx on escrow_transactions(invoice_id);
create index if not exists invoice_events_invoice_id_idx on invoice_events(invoice_id);
create index if not exists seller_payouts_invoice_id_idx on seller_payouts(invoice_id);
create index if not exists seller_payouts_status_idx on seller_payouts(status);

create or replace function settleflow_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists invoices_touch_updated_at on invoices;
create trigger invoices_touch_updated_at
before update on invoices
for each row execute function settleflow_touch_updated_at();

alter table users enable row level security;
alter table invoices enable row level security;
alter table escrow_transactions enable row level security;
alter table invoice_events enable row level security;
alter table seller_payouts enable row level security;

drop policy if exists "public can read invoices by share token" on invoices;
create policy "public can read invoices by share token"
on invoices for select
using (share_token is not null);

drop policy if exists "public can read tx for public invoices" on escrow_transactions;
create policy "public can read tx for public invoices"
on escrow_transactions for select
using (exists (select 1 from invoices where invoices.id = escrow_transactions.invoice_id and invoices.share_token is not null));

drop policy if exists "public can read events for public invoices" on invoice_events;
create policy "public can read events for public invoices"
on invoice_events for select
using (exists (select 1 from invoices where invoices.id = invoice_events.invoice_id and invoices.share_token is not null));

drop policy if exists "public can read payouts for public invoices" on seller_payouts;
create policy "public can read payouts for public invoices"
on seller_payouts for select
using (exists (select 1 from invoices where invoices.id = seller_payouts.invoice_id and invoices.share_token is not null));

-- Realtime publication. Enable replication in Supabase dashboard if needed.
do $$
begin
  begin
    alter publication supabase_realtime add table invoices;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table escrow_transactions;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table invoice_events;
  exception when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table seller_payouts;
  exception when duplicate_object then null;
  end;
end $$;
