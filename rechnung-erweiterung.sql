alter table public.business_profiles
  add column if not exists account_holder text,
  add column if not exists iban text,
  add column if not exists bic text;

alter table public.bookings
  add column if not exists customer_name text,
  add column if not exists customer_street text,
  add column if not exists customer_postal_code text,
  add column if not exists customer_city text;
