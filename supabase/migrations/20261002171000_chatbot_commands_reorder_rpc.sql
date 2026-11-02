create or replace function public.chatbot_reordenar_comandos(p_owner uuid, p_items text[])
returns void language plpgsql security invoker set search_path = public as $$
declare
  command_count integer;
  supplied_count integer;
begin
  if p_owner is null or p_items is null then raise exception 'Dados de ordenação inválidos.'; end if;
  select count(*) into command_count from public.chatbot_comandos where owner_id=p_owner;
  supplied_count := coalesce(array_length(p_items,1),0);
  if supplied_count <> command_count+1
    or (select count(distinct item) from unnest(p_items) item) <> supplied_count
    or (select count(*) from unnest(p_items) item where item='__invalid__') <> 1
    or exists (
      select 1 from unnest(p_items) item
      where item<>'__invalid__'
      and not exists (select 1 from public.chatbot_comandos c where c.owner_id=p_owner and c.id::text=item)
    )
  then raise exception 'A lista de comandos mudou. Atualize e tente novamente.'; end if;
  insert into public.chatbot_comandos_config(owner_id) values (p_owner) on conflict(owner_id) do nothing;
  update public.chatbot_comandos c
    set ordem=x.ordinality::integer*10, updated_at=now()
    from unnest(p_items) with ordinality as x(item,ordinality)
    where c.owner_id=p_owner and c.id::text=x.item and x.item<>'__invalid__';
  update public.chatbot_comandos_config
    set ordem=array_position(p_items,'__invalid__')*10, updated_at=now()
    where owner_id=p_owner;
end; $$;
revoke all on function public.chatbot_reordenar_comandos(uuid,text[]) from public, anon, authenticated;
grant execute on function public.chatbot_reordenar_comandos(uuid,text[]) to service_role;