create table if not exists public.telegram_known_chats (
  chat_id text primary key,
  title text,
  username text,
  chat_type text not null default 'group',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.chatbot_status_sync (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  ativo boolean not null default false,
  telegram_chat_id text,
  telegram_chat_title text,
  postar_imagem boolean not null default true,
  postar_video boolean not null default false,
  postar_texto boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chatbot_status_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  telegram_update_id bigint not null,
  telegram_message_id bigint,
  telegram_chat_id text not null,
  telegram_chat_title text,
  tipo text not null,
  legenda text,
  status text not null default 'processando',
  erro text,
  whatsapp_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (owner_id, telegram_update_id)
);

create index if not exists chatbot_status_posts_owner_created_idx
  on public.chatbot_status_posts (owner_id, created_at desc);

create index if not exists chatbot_status_sync_chat_active_idx
  on public.chatbot_status_sync (telegram_chat_id)
  where ativo = true;

alter table public.telegram_known_chats enable row level security;
alter table public.chatbot_status_sync enable row level security;
alter table public.chatbot_status_posts enable row level security;

drop policy if exists "status_sync_owner_select" on public.chatbot_status_sync;
create policy "status_sync_owner_select"
  on public.chatbot_status_sync for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "status_sync_owner_update" on public.chatbot_status_sync;
create policy "status_sync_owner_update"
  on public.chatbot_status_sync for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "status_posts_owner_select" on public.chatbot_status_posts;
create policy "status_posts_owner_select"
  on public.chatbot_status_posts for select
  to authenticated
  using (owner_id = (select auth.uid()));
