import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {normalizeInventoryPerfumeName,reconcileInventoryGroup} from './ai-inventory'
import type {AiSalesBatchGroup,OperationalInventoryRow} from './records'

const group=(name:string):AiSalesBatchGroup=>({perfume:name,raw_perfume_name:name,normalized_perfume_name:normalizeInventoryPerfumeName(name),display_name:name.replace(/\s*\(FRASCO \d+\)$/i,''),brand:null,bottle_number:null,inventory_item_id:null,perfume_id:null,perfume_match_status:'new',perfume_matches:[],inventory:null,sales:[],availability_rows:0,totals:{sales:8,volume_ml:50,amount:2458}})
const item=(id:string,name:string):OperationalInventoryRow=>({item_id:id,perfume_id:`perfume-${id}`,perfume:name,physical_ml:23,reserved_ml:0,shipping_ml:0,available_ml:23,minimum_ml:0,reconciliation_status:'reconciled'})

describe('resolução do inventário na preview',()=>{
  it.each([['FÈVE NECTAR - PLACE DE LA RÊVERIE','Fève Nectar — Place de la Rêverie'],['THAYS - FUEGUIA 1833','thays — fueguia 1833'],['BLOCKADE - MIND GAMES (FRASCO 2)','Blockade — Mind Games'],['BLONDE  AMBER - CLIVE CHRISTIAN','blonde amber — clive christian']])('faz match forte de %s',(raw,canonical)=>expect(reconcileInventoryGroup(group(raw),[item('1',canonical)])).toMatchObject({inventory_item_id:'1',perfume_match_status:'found'}))
  it('aceita marca ausente somente quando há uma possibilidade',()=>expect(reconcileInventoryGroup(group('FÈVE NECTAR'),[item('1','Fève Nectar — Place de la Rêverie')]).inventory_item_id).toBe('1'))
  it('bloqueia correspondência ambígua',()=>expect(reconcileInventoryGroup(group('OUD'),[item('1','Oud Wood'),item('2','Oud Satin Mood'),item('3','Oud for Greatness')])).toMatchObject({inventory_item_id:null,perfume_match_status:'review'}))
  it('classifica ausência real sem perder o nome',()=>expect(reconcileInventoryGroup(group('SISSA - MIND GAMES'),[])).toMatchObject({inventory_item_id:null,perfume_match_status:'new',raw_perfume_name:'SISSA - MIND GAMES'}))
})

describe('bootstrap SQL auditável',()=>{
  const sql=readFileSync(new URL('../../supabase/migrations/202608140002_ai_inventory_bootstrap.sql',import.meta.url),'utf8')
  it('deriva a soma das vendas e registra opening a conferir',()=>{expect(sql).toContain("sum((sale->>'volume_ml')::numeric)");expect(sql).toContain("'opening',bootstrap_ml,0,bootstrap_ml,'bootstrap_from_sales'");expect(sql).toContain("'review_required'")})
  it('é idempotente por tenant, fingerprint e perfume',()=>{expect(sql).toContain('unique(organization_id,fingerprint,normalized_perfume_name)');expect(sql).toContain('pg_advisory_xact_lock');expect(sql).toContain("'idempotent',true")})
  it('repete o match forte na transação e bloqueia ambiguidade',()=>{expect(sql).toContain('position(normalized in public.normalize_ai_perfume_name');expect(sql).toContain("item_matches>1 then raise exception 'inventory_resolution_ambiguous'");expect(sql).toContain("perfume_matches>1 then raise exception 'perfume_resolution_ambiguous'")})
  it('não infla item existente e vincula vendas ao item real',()=>{expect(sql).toContain("'bootstrap_ml',0");expect(sql).toContain('perfume_id,inventory_item_id,sale_date');expect(sql).toContain("'pending'")})
  it('preserva isolamento e o bloqueio multiperfume',()=>{expect(sql).toContain('has_org_role');expect(sql).toContain('i.organization_id=p_organization_id');expect(sql).toContain("raise exception 'multi_perfume_batch_not_supported'");expect(sql).not.toContain('insert into public.shipments');expect(sql).not.toContain('superfrete')})
})

describe('bootstrap não cria disponibilidade falsa',()=>{
  const sql=readFileSync(new URL('../../supabase/migrations/202608140002_ai_inventory_bootstrap.sql',import.meta.url),'utf8')
  it('A: item novo nasce marcado como pendente de conferência, auditável mas indisponível',()=>{
    expect(sql).toContain('add column if not exists bootstrap_pending_verification boolean not null default false')
    expect(sql).toContain("'active','Estoque registrado pelas vendas; aguardando conferência física. Origem: ai_sales_batch.','review_required',true,auth.uid())")
  })
  it('fonte canônica de disponibilidade zera item pendente sem apagar o físico',()=>{
    expect(sql).toContain('case when i.bootstrap_pending_verification then 0 else i.available_ml end')
    expect(sql).toContain('i.physical_ml,')
  })
  it('mesma regra vale para o resumo/relatórios de estoque (Estoque, Importação IA, qualquer seletor)',()=>{
    expect(sql).toContain("coalesce(sum(case when i.bootstrap_pending_verification then 0 else i.available_ml end),0)")
    expect(sql).toContain("case when i.bootstrap_pending_verification or i.available_ml=0 then 'Esgotado'")
  })
  it('B: retry idempotente não duplica nem soma ml de novo',()=>{
    expect(sql).toContain("'idempotent',true")
    expect(sql).toContain('unique(organization_id,fingerprint,normalized_perfume_name)')
  })
  it('C: nova análise do mesmo perfume reutiliza o item review_required em vez de duplicar',()=>{
    expect(sql).toContain("if item.status<>'active' then raise exception 'inventory_item_inactive'; end if;")
    expect(sql).not.toContain("item.reconciliation_status<>'active'")
    expect(sql).not.toContain("if item.reconciliation_status='review_required'")
  })
  it('D: conferência física via inventory_apply (Entrada/Ajustar) libera o item para disponibilidade normal',()=>{
    expect(sql).toContain("v_confirms:=p_type in('entry','positive_adjustment','negative_adjustment','administrative_correction')")
    expect(sql).toContain('bootstrap_pending_verification=case when v_confirms then false else bootstrap_pending_verification end')
    expect(sql).toContain("reconciliation_status=case when v_confirms and reconciliation_status='review_required' then 'reconciled' else reconciliation_status end")
  })
  it('E: item já ativo não recebe bootstrap extra nem é remarcado como pendente',()=>{
    expect(sql).toContain("'bootstrap_ml',0")
    expect(sql).not.toContain('bootstrap_pending_verification=true where item_matches')
  })
  it('não cria allocation nem reserva para resolver o risco de disponibilidade falsa',()=>{
    expect(sql).not.toContain('insert into public.inventory_allocations')
  })
})
