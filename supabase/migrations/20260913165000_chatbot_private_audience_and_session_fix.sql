-- Chatbot: separa contatos salvos e nao salvos no privado
-- e persiste a correcao do ciclo de vida das sessoes.

alter table public.chatbot_fluxos
  add column if not exists permitir_privado_salvos boolean not null default true,
  add column if not exists permitir_privado_nao_salvos boolean not null default true;

-- Converte a configuracao antiga para as duas permissoes independentes.
update public.chatbot_fluxos
set
  permitir_privado_salvos =
    case
      when permitir_privado = true and somente_nao_salvos = false then true
      else false
    end,
  permitir_privado_nao_salvos =
    case
      when permitir_privado = true then true
      else false
    end;

comment on column public.chatbot_fluxos.permitir_privado_salvos
  is 'Permite iniciar o fluxo em conversas privadas quando o contato esta salvo.';

comment on column public.chatbot_fluxos.permitir_privado_nao_salvos
  is 'Permite iniciar o fluxo em conversas privadas quando o contato nao esta salvo ou nao pode ser confirmado como salvo.';

-- Mantem um relogio imutavel desde o inicio do atendimento.
alter table public.chatbot_sessoes
  add column if not exists started_at timestamptz not null default now();

-- O motor usa "iniciando" como trava contra inicios duplicados.
alter table public.chatbot_sessoes
  drop constraint if exists chatbot_sessoes_status_check;

alter table public.chatbot_sessoes
  add constraint chatbot_sessoes_status_check
  check (status = any (array[
    'ativo'::text,
    'iniciando'::text,
    'aguardando_botao'::text,
    'finalizado'::text
  ]));
