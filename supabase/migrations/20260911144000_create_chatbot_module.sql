-- Módulo Chatbot do Gestor Nexos
create table if not exists public.chatbot_config (
  id uuid primary key default gen_random_uuid(),
  chave text not null default 'default' unique,
  ativo boolean not null default false,
  somente_clientes boolean not null default false,
  delay_segundos integer not null default 2 check (delay_segundos between 0 and 30),
  resposta_padrao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.chatbot_config (chave, ativo, somente_clientes, delay_segundos)
values ('default', false, false, 2)
on conflict (chave) do nothing;

create table if not exists public.chatbot_regras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  palavras text[] not null default '{}',
  tipo_match text not null default 'contem' check (tipo_match in ('contem','exato','qualquer')),
  mensagem_id uuid references public.mensagens(id) on delete set null,
  resposta_texto text,
  transferir_humano boolean not null default false,
  ativo boolean not null default true,
  prioridade integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chatbot_regra_resposta check (
    mensagem_id is not null
    or nullif(trim(coalesce(resposta_texto,'')), '') is not null
    or transferir_humano = true
  )
);

create index if not exists chatbot_regras_ativo_prioridade_idx
  on public.chatbot_regras (ativo, prioridade, created_at);

create table if not exists public.chatbot_historico (
  id uuid primary key default gen_random_uuid(),
  event_key text unique,
  whatsapp text,
  cliente_id uuid references public.clientes(id) on delete set null,
  regra_id uuid references public.chatbot_regras(id) on delete set null,
  mensagem_recebida text not null,
  resposta_enviada text,
  status text not null default 'recebido'
    check (status in ('recebido','respondido','transferido','sem_regra','ignorado','falhou')),
  erro text,
  recebido_em timestamptz not null default now(),
  respondido_em timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists chatbot_historico_recebido_idx
  on public.chatbot_historico (recebido_em desc);

alter table public.chatbot_config enable row level security;
alter table public.chatbot_regras enable row level security;
alter table public.chatbot_historico enable row level security;

drop policy if exists chatbot_config_authenticated_all on public.chatbot_config;
create policy chatbot_config_authenticated_all
on public.chatbot_config for all to authenticated
using (true) with check (true);

drop policy if exists chatbot_regras_authenticated_all on public.chatbot_regras;
create policy chatbot_regras_authenticated_all
on public.chatbot_regras for all to authenticated
using (true) with check (true);

drop policy if exists chatbot_historico_authenticated_read on public.chatbot_historico;
create policy chatbot_historico_authenticated_read
on public.chatbot_historico for select to authenticated
using (true);

grant select, insert, update, delete on public.chatbot_config to authenticated;
grant select, insert, update, delete on public.chatbot_regras to authenticated;
grant select on public.chatbot_historico to authenticated;
