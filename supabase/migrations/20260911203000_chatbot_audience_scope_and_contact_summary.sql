-- Chatbot: resumo por contato e regras de público por fluxo.
-- Mantém fluxos existentes restritos ao privado por padrão.

alter table public.chatbot_fluxos
  add column if not exists permitir_privado boolean not null default true,
  add column if not exists permitir_grupos boolean not null default false,
  add column if not exists somente_nao_salvos boolean not null default false,
  add column if not exists grupo_modo text not null default 'todos',
  add column if not exists grupos_ids text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chatbot_fluxos_grupo_modo_check'
      and conrelid = 'public.chatbot_fluxos'::regclass
  ) then
    alter table public.chatbot_fluxos
      add constraint chatbot_fluxos_grupo_modo_check
      check (grupo_modo in ('todos', 'selecionados'));
  end if;
end $$;

alter table public.chatbot_historico
  add column if not exists nome_contato text,
  add column if not exists chat_jid text,
  add column if not exists tipo_conversa text not null default 'privado',
  add column if not exists mensagens_enviadas integer not null default 0;

create index if not exists chatbot_historico_chat_jid_recebido_idx
  on public.chatbot_historico (chat_jid, recebido_em desc);

create index if not exists chatbot_historico_whatsapp_recebido_idx
  on public.chatbot_historico (whatsapp, recebido_em desc);
