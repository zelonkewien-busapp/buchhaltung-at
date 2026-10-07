create table if not exists public.incoming_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplier text not null default '',
  invoice_number text,
  invoice_date date,
  total_amount numeric(12,2),
  notes text not null default '',
  storage_path text,
  ocr_text text,
  status text not null default 'review'
    check (status in ('review', 'saved')),
  created_at timestamptz not null default now()
);

alter table public.incoming_expenses enable row level security;

drop policy if exists incoming_expenses_select_own on public.incoming_expenses;
create policy incoming_expenses_select_own
  on public.incoming_expenses for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists incoming_expenses_insert_own on public.incoming_expenses;
create policy incoming_expenses_insert_own
  on public.incoming_expenses for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists incoming_expenses_update_own on public.incoming_expenses;
create policy incoming_expenses_update_own
  on public.incoming_expenses for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists incoming_expenses_delete_own on public.incoming_expenses;
create policy incoming_expenses_delete_own
  on public.incoming_expenses for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete
  on public.incoming_expenses to authenticated;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'incoming-invoices',
  'incoming-invoices',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists incoming_invoice_files_own on storage.objects;
create policy incoming_invoice_files_own
  on storage.objects for all to authenticated
  using (
    bucket_id = 'incoming-invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'incoming-invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
