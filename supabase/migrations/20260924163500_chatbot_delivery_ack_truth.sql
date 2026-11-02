-- Chatbot: status de envio baseado em ACK real do WhatsApp
create table if not exists public.chatbot_outbound_ack (
  message_id text primary key,
  history_id uuid references public.chatbot_historico(id) on delete cascade,
  whatsapp text,
  action text,
  ack integer not null default 0,
  ack_name text not null default 'PENDING',
  target_status text not null default 'respondido',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chatbot_outbound_ack_history_idx
  on public.chatbot_outbound_ack(history_id);

create index if not exists chatbot_outbound_ack_whatsapp_idx
  on public.chatbot_outbound_ack(whatsapp);

alter table public.chatbot_outbound_ack enable row level security;
