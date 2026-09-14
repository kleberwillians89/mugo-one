begin;

-- 1, 2 e 3 eram exemplos, não um limite. A operação pode chegar ao Frasco
-- 20 (ou qualquer outro inteiro positivo) sem perder a identidade no nome.
create or replace function public.normalize_davi_sale_bottle_identity()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.source not in('ai_sales_batch','davi_excel') then return new; end if;
  if new.source='davi_excel' and (new.bottle_identifier is null or new.bottle_identifier !~ '^FRASCO [1-9][0-9]*$') then
    raise exception 'bottle_number_required';
  end if;
  if new.bottle_identifier is not null then
    if new.bottle_identifier !~ '^FRASCO [1-9][0-9]*$' then raise exception 'invalid_bottle_number'; end if;
    new.perfume_name_raw:=btrim(regexp_replace(coalesce(new.perfume_name_raw,new.perfume_base_name,''),'\s*\(\s*FRASCO\s+[0-9]+\s*\)\s*$','','i'))||' ('||new.bottle_identifier||')';
  end if;
  return new;
end;$$;

notify pgrst,'reload schema';
commit;
