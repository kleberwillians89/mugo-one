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
