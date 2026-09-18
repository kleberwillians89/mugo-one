begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- payment.paid emitido de dentro de collections_register_payment — a
-- única transição pending→paid segura encontrada na auditoria (ver
-- docs/FISCAL_MIGRATION_PLAN.md §1). Só para vendas que MUDARAM de
-- verdade (changed_ids) — uma venda já paga com os mesmos dados que
-- caiu em skipped_ids não gera um segundo evento para a mesma
-- transição (idempotência do próprio evento, não só do domain_events).
-- ============================================================

create or replace function public.collections_register_payment(p_sale_ids uuid[], p_paid_at date, p_payment_method text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[]; sale_row public.sales; after_row public.sales;
  changed_ids uuid[]:=array[]::uuid[]; skipped_ids uuid[]:=array[]::uuid[]; resolved_ids uuid[]:=array[]::uuid[];
  note_suffix text; clean_method text;
begin
  if p_sale_ids is null or array_length(p_sale_ids,1) is null then raise exception 'no_sales_selected'; end if;
  if p_paid_at is null then raise exception 'paid_at_required'; end if;
  clean_method:=nullif(btrim(coalesce(p_payment_method,'')),'');
  if clean_method is null then raise exception 'payment_method_required'; end if;
  select array_agg(distinct x) into ids from unnest(p_sale_ids) x;

  for sale_row in
    select * from public.sales
     where id=any(ids) and deleted_at is null and organization_id in(select public.current_user_org_ids())
     order by id for update
  loop
    resolved_ids:=array_append(resolved_ids,sale_row.id);
    if not public.has_org_permission(sale_row.organization_id,'sales.edit') then raise exception 'forbidden'; end if;
    if sale_row.payment_status='cancelled' then raise exception 'sale_cancelled:%',sale_row.id; end if;

    if sale_row.payment_status='paid' then
      if sale_row.paid_at is distinct from p_paid_at or coalesce(sale_row.payment_method,'')<>clean_method then
        raise exception 'sale_already_paid:%',sale_row.id;
      end if;
      skipped_ids:=array_append(skipped_ids,sale_row.id);
      continue;
    end if;

    note_suffix:=nullif(btrim(coalesce(p_notes,'')),'');
    update public.sales set
      payment_status='paid',
      paid_at=p_paid_at,
      payment_method=clean_method,
      notes=case when note_suffix is null then notes
        else trim(both E'\n' from coalesce(notes,'')||case when coalesce(notes,'')<>'' then E'\n' else '' end||'Pagamento: '||note_suffix) end,
      updated_at=now()
     where id=sale_row.id returning * into after_row;

    changed_ids:=array_append(changed_ids,after_row.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(sale_row.organization_id,auth.uid(),'collections_payment_registered','sale',sale_row.id::text,
      jsonb_build_object('sale_id',sale_row.id,'client_id',sale_row.client_id,
        'status_before',sale_row.payment_status,'status_after',after_row.payment_status,
        'paid_at',after_row.paid_at,'payment_method',after_row.payment_method));

    perform public.emit_domain_event(
      sale_row.organization_id, 'payment.paid', 'sale', after_row.id,
      jsonb_build_object('sale_id', after_row.id, 'payment_method', after_row.payment_method, 'paid_at', after_row.paid_at, 'total_amount', after_row.total_amount),
      'collections_register_payment', auth.uid(), null, null
    );
  end loop;

  if array_length(resolved_ids,1) is distinct from array_length(ids,1) then raise exception 'sale_not_found'; end if;

  return jsonb_build_object('changed_sale_ids',to_jsonb(changed_ids),'skipped_sale_ids',to_jsonb(skipped_ids),
    'paid_at',p_paid_at,'payment_method',clean_method);
end;$$;

commit;
