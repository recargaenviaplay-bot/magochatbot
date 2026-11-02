
alter table public.chatbot_status_posts
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

create index if not exists chatbot_status_posts_retry_idx
  on public.chatbot_status_posts (status, created_at, retry_count)
  where status in ('processando','falhou');
