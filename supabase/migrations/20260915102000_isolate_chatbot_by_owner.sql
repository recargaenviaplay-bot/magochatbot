alter table public.chatbot_config add column if not exists owner_id uuid;
alter table public.chatbot_regras add column if not exists owner_id uuid;
alter table public.chatbot_fluxos add column if not exists owner_id uuid;
alter table public.chatbot_historico add column if not exists owner_id uuid;

create index if not exists chatbot_config_owner_idx on public.chatbot_config(owner_id);
create index if not exists chatbot_regras_owner_idx on public.chatbot_regras(owner_id, prioridade, created_at);
create index if not exists chatbot_fluxos_owner_idx on public.chatbot_fluxos(owner_id, prioridade, created_at);
create index if not exists chatbot_historico_owner_idx on public.chatbot_historico(owner_id, recebido_em desc);
