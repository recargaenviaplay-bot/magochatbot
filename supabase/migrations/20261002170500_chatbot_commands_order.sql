alter table public.chatbot_comandos add column if not exists ordem integer;
with ordered as (
  select id, row_number() over (partition by owner_id order by created_at desc, id) * 10 as position
  from public.chatbot_comandos where ordem is null
)
update public.chatbot_comandos as command set ordem=ordered.position
from ordered where command.id=ordered.id;
alter table public.chatbot_comandos alter column ordem set default 100000;
alter table public.chatbot_comandos alter column ordem set not null;
alter table public.chatbot_comandos_config add column if not exists ordem integer not null default 100000;
update public.chatbot_comandos_config as cfg
set ordem = coalesce((select max(c.ordem) + 10 from public.chatbot_comandos c where c.owner_id=cfg.owner_id),10)
where cfg.ordem=100000;
create index if not exists chatbot_comandos_list_order_idx on public.chatbot_comandos(owner_id,ordem,created_at);