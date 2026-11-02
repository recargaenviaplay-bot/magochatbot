alter table public.assinaturas_gestor
  drop constraint if exists assinaturas_gestor_plano_check;

alter table public.assinaturas_gestor
  add constraint assinaturas_gestor_plano_check
  check (
    plano is null or plano in (
      'mensal',
      'trimestral',
      'semestral',
      'anual',
      'mensal_chatbot',
      'trimestral_chatbot'
    )
  );

alter table public.pagamentos_assinatura
  drop constraint if exists pagamentos_assinatura_plano_check;

alter table public.pagamentos_assinatura
  add constraint pagamentos_assinatura_plano_check
  check (
    plano in (
      'mensal',
      'trimestral',
      'semestral',
      'anual',
      'mensal_chatbot',
      'trimestral_chatbot'
    )
  );

create or replace function public.finalizar_pagamento_assinatura(
  p_order_id text,
  p_payment_id text default null::text,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.pagamentos_assinatura%rowtype;
  v_months integer;
  v_current_end timestamptz;
  v_new_end timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Acesso não autorizado';
  end if;

  select *
    into v_payment
  from public.pagamentos_assinatura
  where
    (p_payment_id is not null and mercadopago_payment_id = p_payment_id)
    or (p_order_id is not null and mercadopago_order_id = p_order_id)
    or (p_order_id is not null and mercadopago_payment_id = p_order_id)
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  if v_payment.status = 'approved' then
    select current_period_ends_at
      into v_current_end
    from public.assinaturas_gestor
    where user_id = v_payment.user_id;

    return jsonb_build_object(
      'ok', true,
      'already_approved', true,
      'payment_id', v_payment.id,
      'user_id', v_payment.user_id,
      'current_period_ends_at', v_current_end
    );
  end if;

  v_months := case v_payment.plano
    when 'mensal' then 1
    when 'trimestral' then 3
    when 'semestral' then 6
    when 'anual' then 12
    when 'mensal_chatbot' then 1
    when 'trimestral_chatbot' then 3
    else null
  end;

  if v_months is null then
    raise exception 'Plano de pagamento inválido';
  end if;

  select current_period_ends_at
    into v_current_end
  from public.assinaturas_gestor
  where user_id = v_payment.user_id
  for update;

  v_new_end := greatest(coalesce(v_current_end, now()), now())
    + make_interval(months => v_months);

  update public.pagamentos_assinatura
  set status = 'approved',
      mercadopago_payment_id = coalesce(p_payment_id, mercadopago_payment_id),
      paid_at = coalesce(paid_at, p_paid_at),
      updated_at = now()
  where id = v_payment.id;

  insert into public.assinaturas_gestor (
    user_id,
    plano,
    status,
    current_period_ends_at,
    updated_at
  ) values (
    v_payment.user_id,
    v_payment.plano,
    'active',
    v_new_end,
    now()
  )
  on conflict (user_id) do update
  set plano = excluded.plano,
      status = 'active',
      current_period_ends_at = excluded.current_period_ends_at,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'already_approved', false,
    'payment_id', v_payment.id,
    'user_id', v_payment.user_id,
    'plano', v_payment.plano,
    'chatbot_incluido', v_payment.plano in ('mensal_chatbot','trimestral_chatbot'),
    'current_period_ends_at', v_new_end
  );
end;
$function$;
