create table if not exists settleflow_users (
  id text primary key,
  email text not null unique,
  name text not null,
  company text,
  password_hash text not null,
  reset_code text,
  reset_code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settleflow_invoices (
  id text primary key,
  owner_user_id text not null references settleflow_users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists settleflow_invoices_owner_user_id_idx
  on settleflow_invoices(owner_user_id);

create or replace function settleflow_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists settleflow_users_updated_at on settleflow_users;
create trigger settleflow_users_updated_at
before update on settleflow_users
for each row execute function settleflow_set_updated_at();

drop trigger if exists settleflow_invoices_updated_at on settleflow_invoices;
create trigger settleflow_invoices_updated_at
before update on settleflow_invoices
for each row execute function settleflow_set_updated_at();
