-- Números que o Chatbot deve ignorar completamente.
alter table public.chatbot_config
  add column if not exists numeros_ignorados text[] not null default '{}';
