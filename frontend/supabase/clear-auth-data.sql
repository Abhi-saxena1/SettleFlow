-- Testing only: clears all SettleFlow users and their invoices.
-- Run this in Supabase SQL Editor when you want a completely fresh auth state.

delete from settleflow_invoices;
delete from settleflow_users;
