create table if not exists public.chatbot_comandos (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 nome text not null,
 gatilho text not null,
 tipo_match text not null default 'exato' check(tipo_match in ('exato','contem')),
 grupos_ids jsonb not null default '[]'::jsonb,
 resposta_texto text not null default '',
 imagem_path text,
 atraso_segundos integer not null default 3 check(atraso_segundos in (1,3,5,10)),
 ativo boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint chatbot_comandos_gatilho_nonempty check(length(trim(gatilho))>0),
 constraint chatbot_comandos_resposta_nonempty check(length(trim(resposta_texto))>0 or nullif(imagem_path,'') is not null)
);
create unique index if not exists chatbot_comandos_owner_gatilho_idx on public.chatbot_comandos(owner_id, lower(gatilho));
create index if not exists chatbot_comandos_active_idx on public.chatbot_comandos(owner_id, ativo);
alter table public.chatbot_comandos enable row level security;
-- Admin API and webhook access only with service-role; no browser direct-table grants.
create table if not exists public.chatbot_comando_eventos (
 owner_id uuid not null,
 event_key text not null,
 comando_id uuid not null references public.chatbot_comandos(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(owner_id,event_key)
);
alter table public.chatbot_comando_eventos enable row level security;