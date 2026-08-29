import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  approvedClientAlias, approvedNewSaleDecision, approvedPerfumeAlias, commercialPerfumeBase, hasExplicitSourceValue, inventoryBaseline,
  isApprovedDistinctMilkPlus, isCancelledSourceMl, isHistoricalZeroMatchingValue,
} from './incremental-approved-decisions.mjs'

describe('decisões humanas do plano incremental', () => {
  it('mantém MILK + distinto de MILK sem criar alias implícito', () => {
    expect(isApprovedDistinctMilkPlus('MILK + - COMMODITY')).toBe(true)
    expect(isApprovedDistinctMilkPlus('MILK - COMMODITY')).toBe(false)
    expect(approvedPerfumeAlias('MILK + - COMMODITY')).toBeNull()
  })

  it('remove somente o identificador estrutural de frasco ao resolver catálogo', () => {
    expect(commercialPerfumeBase('SANTAL CALLING - EX NIHILO (FRASCO 06)')).toBe('santal calling - ex nihilo')
    expect(commercialPerfumeBase('MILK + - COMMODITY')).toBe('milk + - commodity')
  })

  it('resolve somente o alias explícito de MUSC ROGUE', () => {
    expect(approvedPerfumeAlias('MUSC ROGUE - ORMONDE JAYNE')?.targetId).toBe('2c3cce47-15c4-4868-833a-ce51ec28726b')
    expect(approvedPerfumeAlias('MUSC ROGU - ORMONDE JAYNE')).toBeNull()
  })

  it('resolve somente ANA PAULA GIOMBELI para a cliente aprovada', () => {
    expect(approvedClientAlias('ANA PAULA GIOMBELI')?.targetId).toBe('816796c1-d619-47b9-8d82-5d5effd34a91')
    expect(approvedClientAlias('ANA PAULA GIOMBELA')).toBeNull()
  })

  it('usa vazio como zero apenas para matching histórico', () => {
    expect([null, undefined, '', ' - '].every(isHistoricalZeroMatchingValue)).toBe(true)
    expect(isHistoricalZeroMatchingValue(0)).toBe(false)
    expect(isHistoricalZeroMatchingValue('0')).toBe(false)
  })

  it('não planeja apagar campo mutável quando a fonte não informa valor', () => {
    expect([null, undefined, '', ' - '].some(hasExplicitSourceValue)).toBe(false)
    expect(hasExplicitSourceValue(0)).toBe(true)
    expect(hasExplicitSourceValue('PAGO')).toBe(true)
  })

  it.each(['X', 'X (57)', 'x(10)', '(X) 5'])('reconhece %s como cancelamento da fonte', (value) => expect(isCancelledSourceMl(value)).toBe(true))
  it('não trata volume comum como cancelamento', () => expect(isCancelledSourceMl(5)).toBe(false))

  it('mantém as duas vendas de Luciana como decisões exatas de NEW', () => {
    expect(approvedNewSaleDecision({source_client:'LUCIANA ALVES',date:'2026-06-28',source_perfume:'LILYPHÉA - DIPTYQUE (FRASCO 2)',ml:5,amount:158.5})).toBe('LUCIANA_LILYPHEA_NEW')
    expect(approvedNewSaleDecision({source_client:'LUCIANA ALVES',date:'2026-07-02',source_perfume:"SUR TES LEVRES E.Q. - D'ORSAY",ml:5,amount:128.5})).toBe('LUCIANA_SUR_TES_LEVRES_NEW')
  })

  it('calcula o baseline de estoque sem produzir escrita e deduplica códigos operacionais válidos', () => {
    expect(inventoryBaseline({inventory_items:[{physical_ml:10},{physical_ml:2.5}],inventory_movements:[{}],inventory_purchase_entries:[{},{}],perfumes:[{operational_code:'RUAH-P000001'},{operational_code:'ruah-p000001'},{operational_code:'RUAH-P000002'},{operational_code:'RUAH-P2'},{operational_code:null}]})).toEqual({inventory_items:2,inventory_movements:1,inventory_purchase_entries:2,physical_ml:12.5,'RUAH-P':2})
  })

  it('preserva a linha X sem escrita no aplicador', () => {
    const apply = readFileSync('scripts/apply-incremental-workbook.mjs', 'utf8')
    expect(apply).toContain("'skipped_cancelled_source'")
    expect(apply).toContain("filter((row)=>['existing_changed','new_safe'].includes(row.classification))")
  })

  it('assinatura distingue multiplicidade legítima pela linha de origem', () => {
    const analyzer = readFileSync('scripts/analyze-incremental-workbook.mjs', 'utf8')
    expect(analyzer).toContain('hash(`${row.identity}|${row.source_row}`)')
  })

  it('RPC preserva campos ausentes e aceita multiplicidade somente no mesmo lote', () => {
    const migration = readFileSync('supabase/migrations/202608290002_incremental_resolved_references.sql', 'utf8')
    for (const field of ['payment_status', 'payment_method', 'paid_at', 'shipped_at', 'credit']) {
      expect(migration).toContain(`r.item->'proposed_changes'?'${field}'`)
    }
    expect(migration).toContain('s.import_batch_id is distinct from v_batch_id')
    expect(migration).toContain("where organization_id=p_organization_id and file_hash=p_file_hash and status='completed'")
  })

  it('RPC usa IDs canônicos aprovados e não duplica cliente ou perfume resolvido', () => {
    const migration = readFileSync('supabase/migrations/202608290003_incremental_changed_eligible_sales.sql', 'utf8')
    expect(migration).toContain("v_client_id:=nullif(r.item->>'resolved_client_id','')::uuid")
    expect(migration).toContain("v_perfume_id:=nullif(r.item->>'resolved_perfume_id','')::uuid")
    expect(migration).toContain("coalesce(item->>'resolved_client_id','')=''")
    expect(migration).toContain("coalesce(item->>'resolved_perfume_id','')=''")
    expect(migration).toContain("raise exception 'resolved_client_outside_organization'")
    expect(migration).toContain("raise exception 'resolved_perfume_outside_organization'")
  })

  it('CHANGED comercial mantém sale.id e não é bloqueado apenas por elegibilidade operacional', () => {
    const migration = readFileSync('supabase/migrations/202608290003_incremental_changed_eligible_sales.sql', 'utf8')
    expect(migration).toContain("select * into v_sale from public.sales where id=(r.item->>'match_candidate')::uuid")
    expect(migration).toContain("if not found then raise exception 'unsafe_changed_match'")
    expect(migration).not.toContain('not found or v_sale.inventory_allocation_eligible')
  })
})
