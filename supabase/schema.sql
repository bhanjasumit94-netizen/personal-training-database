-- ============================================================================
-- Personal Training Database — Supabase schema
-- ============================================================================
-- Run this once in the Supabase SQL Editor (Project → SQL → New query).
-- It is idempotent: re-running it drops the schema and recreates it.
--
-- After running:
--   1. Storage → Create bucket `client-photos` (public, 5MB limit, image/* mime)
--   2. Authentication → Email auth is enabled by default
--   3. Set your env vars:
--        VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
--        VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
-- ============================================================================

-- Drop everything in the right order so the script is re-runnable
drop policy if exists "Admins can read own row" on public.admins;
drop policy if exists "Admins can update own row" on public.admins;
drop policy if exists "Anyone can insert admin (signup)" on public.admins;

drop policy if exists "Admins can read own clients" on public.clients;
drop policy if exists "Admins can insert own clients" on public.clients;
drop policy if exists "Admins can update own clients" on public.clients;
drop policy if exists "Admins can delete own clients" on public.clients;

drop policy if exists "Admins can read own history" on public.payment_history;
drop policy if exists "Admins can insert own history" on public.payment_history;
drop policy if exists "Admins can update own history" on public.payment_history;
drop policy if exists "Admins can delete own history" on public.payment_history;

drop policy if exists "Admins can read own notifications" on public.notifications;
drop policy if exists "Admins can insert own notifications" on public.notifications;
drop policy if exists "Admins can update own notifications" on public.notifications;
drop policy if exists "Admins can delete own notifications" on public.notifications;

drop policy if exists "Admins can read own settings" on public.admin_settings;
drop policy if exists "Admins can upsert own settings" on public.admin_settings;
drop policy if exists "Admins can update own settings" on public.admin_settings;
drop policy if exists "Admins can delete own settings" on public.admin_settings;

drop policy if exists "Public can read client photos" on storage.objects;
drop policy if exists "Authenticated can upload client photos" on storage.objects;
drop policy if exists "Owner can delete client photos" on storage.objects;

drop table if exists public.admin_settings cascade;
drop table if exists public.notifications cascade;
drop table if exists public.payment_history cascade;
drop table if exists public.clients cascade;
drop table if exists public.admins cascade;

-- ============================================================================
-- admins
-- ============================================================================
-- Application code (src/auth.ts) reads/writes:
--   id, email, name, phone, photo, role, status, created_at, last_login
-- Authentication uses Supabase Auth (auth.users). The `admins` table is
-- just the role/profile record keyed by auth.uid() (FK-friendly).
create table public.admins (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  phone text not null default '',
  photo text not null default '',
  role text not null default 'admin'
    check (role in ('super_admin', 'admin')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create index admins_email_idx on public.admins (email);
create index admins_role_idx on public.admins (role);
create index admins_status_idx on public.admins (status);

-- ============================================================================
-- clients
-- ============================================================================
create table public.clients (
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
create index clients_admin_id_idx on public.clients (admin_id);
create index clients_due_date_idx on public.clients (due_date);
create index clients_admin_due_idx on public.clients (admin_id, due_date);
create index clients_admin_paid_idx on public.clients (admin_id, paid);

-- ============================================================================
-- payment_history
-- ============================================================================
create table public.payment_history (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_name text not null,
  amount numeric(12, 2) not null default 0,
  paid_date date not null,
  created_at timestamptz not null default now()
);
create index payment_history_admin_id_idx on public.payment_history (admin_id);
create index payment_history_client_id_idx on public.payment_history (client_id);
create index payment_history_paid_date_idx on public.payment_history (paid_date);

-- ============================================================================
-- notifications
-- ============================================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admins(id) on delete cascade,
  client_id uuid,
  type text not null
    check (type in (
      'new_client', 'payment_received', 'due_today', 'overdue',
      'client_edited', 'client_deleted', 'upcoming_reminder'
    )),
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_admin_id_idx on public.notifications (admin_id);
create index notifications_read_idx on public.notifications (read);

-- ============================================================================
-- admin_settings  (one row per admin)
-- ============================================================================
create table public.admin_settings (
  admin_id uuid primary key references public.admins(id) on delete cascade,
  owner_name text not null default '',
  owner_image text not null default '',
  weather_place text not null default 'Kolkata, India',
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- Storage bucket for client photos
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-photos',
  'client-photos',
  true,             -- public read (photos are shown in the dashboard)
  5 * 1024 * 1024, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================
alter table public.admins          enable row level security;
alter table public.clients         enable row level security;
alter table public.payment_history enable row level security;
alter table public.notifications   enable row level security;
alter table public.admin_settings  enable row level security;

-- The app's "current admin id" is stored in a server-readable way: we
-- read it from the JWT claim `sub` (set by Supabase Auth) on every
-- authenticated request. The localStorage fallback (when Supabase is
-- disabled) does not run RLS — the app talks to localStorage directly.
--
-- For admins: every admin can only see/edit their OWN row.
create policy "Admins can read own row"
  on public.admins for select
  using (id = auth.uid());

create policy "Admins can update own row"
  on public.admins for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Insert is open (signup flow). The trigger below ensures the inserted
-- row's id matches the auth.uid().
create policy "Anyone can insert admin (signup)"
  on public.admins for insert
  with check (id = auth.uid());

-- Enforce id = auth.uid() on insert
create or replace function public.admins_check_id()
returns trigger language plpgsql as $$
begin
  if new.id is null then
    new.id := auth.uid();
  end if;
  if new.id <> auth.uid() then
    raise exception 'admins.id must equal auth.uid()';
  end if;
  return new;
end;
$$;
drop trigger if exists admins_check_id_trigger on public.admins;
create trigger admins_check_id_trigger
  before insert on public.admins
  for each row execute function public.admins_check_id();

-- Delete is restricted to the row owner.
create policy "Admins can delete own row"
  on public.admins for delete
  using (id = auth.uid());

-- clients: only own admin can read/insert/update/delete
create policy "Admins can read own clients"
  on public.clients for select
  using (admin_id = auth.uid());

create policy "Admins can insert own clients"
  on public.clients for insert
  with check (admin_id = auth.uid());

create policy "Admins can update own clients"
  on public.clients for update
  using (admin_id = auth.uid())
  with check (admin_id = auth.uid());

create policy "Admins can delete own clients"
  on public.clients for delete
  using (admin_id = auth.uid());

-- payment_history: same pattern
create policy "Admins can read own history"
  on public.payment_history for select
  using (admin_id = auth.uid());

create policy "Admins can insert own history"
  on public.payment_history for insert
  with check (admin_id = auth.uid());

create policy "Admins can update own history"
  on public.payment_history for update
  using (admin_id = auth.uid())
  with check (admin_id = auth.uid());

create policy "Admins can delete own history"
  on public.payment_history for delete
  using (admin_id = auth.uid());

-- notifications
create policy "Admins can read own notifications"
  on public.notifications for select
  using (admin_id = auth.uid());

create policy "Admins can insert own notifications"
  on public.notifications for insert
  with check (admin_id = auth.uid());

create policy "Admins can update own notifications"
  on public.notifications for update
  using (admin_id = auth.uid())
  with check (admin_id = auth.uid());

create policy "Admins can delete own notifications"
  on public.notifications for delete
  using (admin_id = auth.uid());

-- admin_settings
create policy "Admins can read own settings"
  on public.admin_settings for select
  using (admin_id = auth.uid());

create policy "Admins can upsert own settings"
  on public.admin_settings for insert
  with check (admin_id = auth.uid());

create policy "Admins can update own settings"
  on public.admin_settings for update
  using (admin_id = auth.uid())
  with check (admin_id = auth.uid());

create policy "Admins can delete own settings"
  on public.admin_settings for delete
  using (admin_id = auth.uid());

-- Storage: client-photos bucket
-- Public read (the bucket is public), only authenticated users can write
create policy "Public can read client photos"
  on storage.objects for select
  using (bucket_id = 'client-photos');

create policy "Authenticated can upload client photos"
  on storage.objects for insert
  with check (
    bucket_id = 'client-photos'
    and auth.role() = 'authenticated'
  );

create policy "Owner can update client photos"
  on storage.objects for update
  using (bucket_id = 'client-photos' and owner = auth.uid())
  with check (bucket_id = 'client-photos' and owner = auth.uid());

create policy "Owner can delete client photos"
  on storage.objects for delete
  using (bucket_id = 'client-photos' and owner = auth.uid());

-- ============================================================================
-- Realtime publication
-- ============================================================================
-- supabase_realtime is built in. We need to add our tables to it so
-- the client can listen for changes via `supabase.channel(...).on(
-- 'postgres_changes', ...)`.
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.payment_history;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.admin_settings;

-- ============================================================================
-- Convenience view: lifetime_collection (sum of all payments per admin)
-- Used by the dashboard's stats. We compute it client-side too, but
-- having it server-side makes it easy to add reports later.
-- ============================================================================
create or replace view public.v_admin_stats as
select
  a.id                                                                as admin_id,
  a.email                                                             as email,
  (select count(*) from public.clients c where c.admin_id = a.id)    as total_clients,
  (select count(*) from public.clients c where c.admin_id = a.id and c.paid)    as paid_clients,
  (select count(*) from public.clients c where c.admin_id = a.id and c.due_date < current_date and not c.paid)  as overdue_clients,
  (select count(*) from public.clients c where c.admin_id = a.id and c.due_date = current_date and not c.paid) as due_now,
  (select coalesce(sum(amount), 0) from public.payment_history ph where ph.admin_id = a.id) as lifetime_collection,
  (select coalesce(sum(amount), 0) from public.payment_history ph
     where ph.admin_id = a.id
       and date_trunc('month', ph.paid_date) = date_trunc('month', current_date)) as this_month_collection
from public.admins a;

-- ============================================================================
-- Done. Quick checklist:
--   [ ] Run this entire script in the Supabase SQL editor.
--   [ ] Storage → Create bucket "client-photos" (public, 5MB, image/*).
--   [ ] Authentication → Email is enabled by default.
--   [ ] Add env vars VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
--       in your .env (local) and in your Vercel project settings.
--   [ ] Re-deploy. The app will use Supabase when env vars are present,
--       and fall back to localStorage when they are not.
-- ============================================================================
