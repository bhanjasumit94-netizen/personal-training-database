-- ============================================================================
-- Forward-only migration — safe to run on an existing database.
-- ============================================================================
-- This file brings an existing Supabase project's schema into the shape
-- the application code expects. Every statement uses IF NOT EXISTS so
-- the migration is idempotent (safe to re-run).
--
-- Use this when:
--   * Your database is older than the latest schema.sql and is missing
--     columns the app reads or writes.
--   * You want to add the new tables/indexes/policies/RLS without
--     dropping any data.
--
-- If you're starting from a fresh database, run supabase/schema.sql
-- instead (it drops and recreates everything cleanly).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admins
-- ----------------------------------------------------------------------------
-- Ensure the new columns and constraints exist.
alter table public.admins
  add column if not exists name text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists photo text not null default '',
  add column if not exists role text not null default 'admin',
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists last_login timestamptz;

-- Ensure the role / status check constraints exist (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admins_role_check'
  ) then
    alter table public.admins
      add constraint admins_role_check check (role in ('super_admin', 'admin'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'admins_status_check'
  ) then
    alter table public.admins
      add constraint admins_status_check check (status in ('active', 'disabled'));
  end if;
end $$;

create unique index if not exists admins_email_idx on public.admins (email);
create index if not exists admins_role_idx on public.admins (role);
create index if not exists admins_status_idx on public.admins (status);

-- ----------------------------------------------------------------------------
-- clients
-- ----------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  name text not null,
  phone text not null,
  amount numeric(12, 2) not null default 0,
  pay_date date not null,
  due_date date not null,
  paid boolean not null default false,
  photo text not null default '',
  last_cycle_pay_date date,
  last_cycle_due_date date,
  last_payment_history_id uuid,
  created_at timestamptz not null default now()
);

-- Add any missing columns to an existing clients table.
alter table public.clients
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists pay_date date,
  add column if not exists due_date date,
  add column if not exists paid boolean not null default false,
  add column if not exists photo text not null default '',
  add column if not exists last_cycle_pay_date date,
  add column if not exists last_cycle_due_date date,
  add column if not exists last_payment_history_id uuid,
  add column if not exists created_at timestamptz not null default now();

create index if not exists clients_admin_id_idx on public.clients (admin_id);
create index if not exists clients_due_date_idx on public.clients (due_date);
create index if not exists clients_admin_due_idx on public.clients (admin_id, due_date);
create index if not exists clients_admin_paid_idx on public.clients (admin_id, paid);

-- ----------------------------------------------------------------------------
-- payment_history
-- ----------------------------------------------------------------------------
create table if not exists public.payment_history (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_name text not null,
  amount numeric(12, 2) not null default 0,
  paid_date date not null,
  created_at timestamptz not null default now()
);

alter table public.payment_history
  add column if not exists client_name text not null default '',
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists paid_date date,
  add column if not exists created_at timestamptz not null default now();

create index if not exists payment_history_admin_id_idx on public.payment_history (admin_id);
create index if not exists payment_history_client_id_idx on public.payment_history (client_id);
create index if not exists payment_history_paid_date_idx on public.payment_history (paid_date);

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  client_id uuid,
  type text not null,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists client_id uuid,
  add column if not exists title text not null default '',
  add column if not exists message text not null default '',
  add column if not exists read boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

-- Add the type-check constraint if missing (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_type_check'
  ) then
    alter table public.notifications
      add constraint notifications_type_check
      check (type in (
        'new_client', 'payment_received', 'due_today', 'overdue',
        'client_edited', 'client_deleted', 'upcoming_reminder'
      ));
  end if;
end $$;

create index if not exists notifications_admin_id_idx on public.notifications (admin_id);
create index if not exists notifications_read_idx on public.notifications (read);

-- ----------------------------------------------------------------------------
-- admin_settings
-- ----------------------------------------------------------------------------
create table if not exists public.admin_settings (
  admin_id uuid primary key references public.admins(id) on delete cascade,
  owner_name text not null default '',
  owner_image text not null default '',
  weather_place text not null default 'Kolkata, India',
  updated_at timestamptz not null default now()
);

alter table public.admin_settings
  add column if not exists owner_name text not null default '',
  add column if not exists owner_image text not null default '',
  add column if not exists weather_place text not null default 'Kolkata, India',
  add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- RLS (idempotent)
-- ----------------------------------------------------------------------------
alter table public.admins          enable row level security;
alter table public.clients         enable row level security;
alter table public.payment_history enable row level security;
alter table public.notifications   enable row level security;
alter table public.admin_settings  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admins' and policyname='Admins can read own row') then
    create policy "Admins can read own row" on public.admins for select using (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admins' and policyname='Admins can update own row') then
    create policy "Admins can update own row" on public.admins for update using (id = auth.uid()) with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admins' and policyname='Anyone can insert admin (signup)') then
    create policy "Anyone can insert admin (signup)" on public.admins for insert with check (id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admins' and policyname='Admins can delete own row') then
    create policy "Admins can delete own row" on public.admins for delete using (id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='Admins can read own clients') then
    create policy "Admins can read own clients" on public.clients for select using (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='Admins can insert own clients') then
    create policy "Admins can insert own clients" on public.clients for insert with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='Admins can update own clients') then
    create policy "Admins can update own clients" on public.clients for update using (admin_id = auth.uid()) with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='clients' and policyname='Admins can delete own clients') then
    create policy "Admins can delete own clients" on public.clients for delete using (admin_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payment_history' and policyname='Admins can read own history') then
    create policy "Admins can read own history" on public.payment_history for select using (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payment_history' and policyname='Admins can insert own history') then
    create policy "Admins can insert own history" on public.payment_history for insert with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payment_history' and policyname='Admins can update own history') then
    create policy "Admins can update own history" on public.payment_history for update using (admin_id = auth.uid()) with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='payment_history' and policyname='Admins can delete own history') then
    create policy "Admins can delete own history" on public.payment_history for delete using (admin_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Admins can read own notifications') then
    create policy "Admins can read own notifications" on public.notifications for select using (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Admins can insert own notifications') then
    create policy "Admins can insert own notifications" on public.notifications for insert with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Admins can update own notifications') then
    create policy "Admins can update own notifications" on public.notifications for update using (admin_id = auth.uid()) with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='Admins can delete own notifications') then
    create policy "Admins can delete own notifications" on public.notifications for delete using (admin_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_settings' and policyname='Admins can read own settings') then
    create policy "Admins can read own settings" on public.admin_settings for select using (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_settings' and policyname='Admins can upsert own settings') then
    create policy "Admins can upsert own settings" on public.admin_settings for insert with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_settings' and policyname='Admins can update own settings') then
    create policy "Admins can update own settings" on public.admin_settings for update using (admin_id = auth.uid()) with check (admin_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_settings' and policyname='Admins can delete own settings') then
    create policy "Admins can delete own settings" on public.admin_settings for delete using (admin_id = auth.uid());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Storage bucket (idempotent)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-photos',
  'client-photos',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Public can read client photos') then
    create policy "Public can read client photos"
      on storage.objects for select
      using (bucket_id = 'client-photos');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Authenticated can upload client photos') then
    create policy "Authenticated can upload client photos"
      on storage.objects for insert
      with check (bucket_id = 'client-photos' and auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Owner can update client photos') then
    create policy "Owner can update client photos"
      on storage.objects for update
      using (bucket_id = 'client-photos' and owner = auth.uid())
      with check (bucket_id = 'client-photos' and owner = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Owner can delete client photos') then
    create policy "Owner can delete client photos"
      on storage.objects for delete
      using (bucket_id = 'client-photos' and owner = auth.uid());
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Realtime publication (idempotent)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'clients'
  ) then
    alter publication supabase_realtime add table public.clients;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_history'
  ) then
    alter publication supabase_realtime add table public.payment_history;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_settings'
  ) then
    alter publication supabase_realtime add table public.admin_settings;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Super Admin bootstrap (idempotent)
-- ----------------------------------------------------------------------------
-- After running this migration, the Super Admin's `public.admins`
-- row will exist with role = 'super_admin'. The user must already
-- exist in Supabase Auth (create the user in the dashboard first).
insert into public.admins (id, email, name, phone, photo, role, status, created_at)
select id, email, 'Super Admin', '', '', 'super_admin', 'active', now()
from auth.users
where email = 'bhanja.sumit94.sb@gmail.com'
on conflict (id) do update
  set role = 'super_admin',
      status = 'active',
      name = 'Super Admin',
      updated_at = coalesce(public.admins.last_login, now());
