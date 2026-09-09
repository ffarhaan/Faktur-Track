-- Jalankan script ini di Supabase Dashboard > SQL Editor

create extension if not exists "pgcrypto";

create table if not exists faktur_records (
  id uuid primary key default gen_random_uuid(),
  no_faktur text not null,
  no_delivery_order text,
  no_sales_order text,
  status_cetak boolean not null default false,
  printed_at timestamptz,
  imported_at timestamptz not null default now(),  -- kapan terakhir diimport dari Excel
  extra jsonb not null default '{}'::jsonb,   -- kolom-kolom lain dari Excel yang tidak dipetakan
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint faktur_records_no_faktur_key unique (no_faktur)
);

create index if not exists idx_faktur_records_no_do on faktur_records (no_delivery_order);
create index if not exists idx_faktur_records_no_so on faktur_records (no_sales_order);
create index if not exists idx_faktur_records_status on faktur_records (status_cetak);
create index if not exists idx_faktur_records_imported_at on faktur_records (imported_at);

-- auto-update kolom updated_at
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_updated_at on faktur_records;
create trigger trg_set_updated_at
before update on faktur_records
for each row execute function set_updated_at();

-- Aktifkan Row Level Security. Karena ini tool internal tanpa login user,
-- kita izinkan akses penuh lewat anon key. Kalau nanti mau tambah login,
-- tinggal ganti policy ini.
alter table faktur_records enable row level security;

drop policy if exists "allow all for anon" on faktur_records;
create policy "allow all for anon"
on faktur_records
for all
to anon
using (true)
with check (true);
