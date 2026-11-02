create table if not exists public.whatsapp_call_settings (
  instance_name text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  reject_call boolean not null default false,
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_call_settings enable row level security;

drop policy if exists "whatsapp_call_settings_select_own" on public.whatsapp_call_settings;
create policy "whatsapp_call_settings_select_own"
on public.whatsapp_call_settings
for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "whatsapp_call_settings_insert_own" on public.whatsapp_call_settings;
create policy "whatsapp_call_settings_insert_own"
on public.whatsapp_call_settings
for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "whatsapp_call_settings_update_own" on public.whatsapp_call_settings;
create policy "whatsapp_call_settings_update_own"
on public.whatsapp_call_settings
for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create index if not exists whatsapp_call_settings_owner_id_idx
  on public.whatsapp_call_settings(owner_id);

create table if not exists public.whatsapp_call_events (
  instance_name text not null,
  call_id text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  caller_jid text,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (instance_name, call_id)
);

alter table public.whatsapp_call_events enable row level security;

create index if not exists whatsapp_call_events_owner_id_idx
  on public.whatsapp_call_events(owner_id);
create index if not exists whatsapp_call_events_created_at_idx
  on public.whatsapp_call_events(created_at desc);
