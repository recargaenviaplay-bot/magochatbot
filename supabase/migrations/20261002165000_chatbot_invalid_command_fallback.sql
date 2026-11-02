create table if not exists public.chatbot_comandos_config (
  owner_id uuid primary key,
  invalido_ativo boolean not null default false,
  invalido_texto text not null default 'Comando não é válido.',
  grupos_ids jsonb not null default '[]'::jsonb,
  atraso_segundos integer not null default 3 check (atraso_segundos in (1,3,5,10)),
  updated_at timestamptz not null default now(),
  constraint chatbot_comandos_config_texto check(length(trim(invalido_texto))>0)
);
alter table public.chatbot_comandos_config enable row level security;