do $$
begin
  if not exists (select 1 from vault.secrets where name='waha_master_api_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'waha_master_api_key',
      'WAHA API key for Nexos master WhatsApp'
    );
  end if;

  if not exists (select 1 from vault.secrets where name='waha_webhook_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32),'hex'),
      'waha_webhook_secret',
      'Webhook secret for WAHA -> Nexos'
    );
  end if;
end $$;

create table if not exists public.whatsapp_provider_config (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'evolution' check (provider in ('evolution','waha')),
  enabled boolean not null default false,
  base_url text,
  session_name text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_provider_config enable row level security;

insert into public.whatsapp_provider_config(owner_id, provider, enabled, base_url, session_name)
values (
  '7b511665-4697-42f3-b82e-a42a431a70ef',
  'evolution',
  false,
  'http://46.8.102.246:3001',
  'nexos-master'
)
on conflict (owner_id) do update
  set base_url=excluded.base_url,
      session_name=excluded.session_name,
      updated_at=now();

create or replace function public.get_whatsapp_provider_runtime(p_owner_id uuid)
returns table(
  provider text,
  enabled boolean,
  base_url text,
  session_name text,
  api_key text,
  webhook_secret text
)
language sql
security definer
set search_path = public, vault
as $$
  select
    c.provider,
    c.enabled,
    c.base_url,
    c.session_name,
    (select decrypted_secret from vault.decrypted_secrets where name='waha_master_api_key' limit 1),
    (select decrypted_secret from vault.decrypted_secrets where name='waha_webhook_secret' limit 1)
  from public.whatsapp_provider_config c
  where c.owner_id = p_owner_id;
$$;

revoke all on function public.get_whatsapp_provider_runtime(uuid) from public, anon, authenticated;
grant execute on function public.get_whatsapp_provider_runtime(uuid) to service_role;
