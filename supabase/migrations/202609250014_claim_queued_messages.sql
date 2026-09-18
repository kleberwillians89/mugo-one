begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- claim_queued_messages: usada só pelo automation-worker. FOR UPDATE
-- SKIP LOCKED garante que duas chamadas concorrentes desta RPC nunca
-- devolvem a mesma message (briefing §29). O lock dura só a transação
-- da própria RPC — não existe um estado "em processamento" persistido
-- (messages.status não tem esse valor); a janela residual entre o
-- retorno da RPC e o envio de fato é aceita como limite documentado
-- nesta primeira versão (invocação sob demanda, não polling
-- concorrente) — na pior hipótese, update_message_delivery_status já
-- é idempotente por rank de status, então um duplo-processamento nunca
-- corrompe o dado, só desperdiça uma chamada ao provider.
-- ============================================================

create or replace function public.claim_queued_messages(p_limit integer default 20)
returns table (
  id uuid, conversation_id uuid, organization_id uuid,
  recipient_identity text, sender_identity text, body_text text, subject text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query
  select m.id, m.conversation_id, m.organization_id, m.recipient_identity, m.sender_identity, m.body_text, c.subject
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.status = 'queued' and m.direction = 'outbound' and m.provider = 'resend'
  order by m.created_at
  limit greatest(1, least(p_limit, 100))
  for update of m skip locked;
end;
$$;

revoke all on function public.claim_queued_messages(integer) from public, anon, authenticated;
grant execute on function public.claim_queued_messages(integer) to service_role;

commit;
