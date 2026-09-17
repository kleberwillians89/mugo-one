import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = (name: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8')

const leads = migration('202609190001_crm_leads.sql')
const pipelines = migration('202609190002_crm_pipelines.sql')
const deals = migration('202609190003_crm_deals.sql')
const history = migration('202609190004_crm_deal_stage_history.sql')
const conversion = migration('202609190005_crm_lead_conversion.sql')
const sql = [leads, pipelines, deals, history, conversion].join('\n')

const leadQueries = readFileSync(new URL('./leads/lead.queries.ts', import.meta.url), 'utf8')
const leadMutations = readFileSync(new URL('./leads/lead.mutations.ts', import.meta.url), 'utf8')
const dealQueries = readFileSync(new URL('./deals/deal.queries.ts', import.meta.url), 'utf8')
const dealMutations = readFileSync(new URL('./deals/deal.mutations.ts', import.meta.url), 'utf8')
const pipelineQueries = readFileSync(new URL('./pipelines/pipeline.queries.ts', import.meta.url), 'utf8')
const pipelineMutations = readFileSync(new URL('./pipelines/pipeline.mutations.ts', import.meta.url), 'utf8')
const frontend = [leadQueries, leadMutations, dealQueries, dealMutations, pipelineQueries, pipelineMutations].join('\n')

describe('CRM comercial — modelo genérico e permissões existentes', () => {
  it('cria leads, pipelines, stages, deals e histórico com organization_id', () => {
    for (const table of ['leads', 'pipelines', 'pipeline_stages', 'deals', 'deal_stage_history']) {
      expect(sql).toContain(`create table public.${table}`)
      const start = sql.indexOf(`create table public.${table}`)
      const end = sql.indexOf(');', start)
      expect(sql.slice(start, end)).toContain('organization_id uuid not null')
    }
  })

  it('estende o catálogo canônico sem criar uma terceira autorização', () => {
    for (const code of [
      'crm.leads.view',
      'crm.leads.manage',
      'crm.deals.view',
      'crm.deals.manage',
      'crm.pipelines.manage',
    ]) expect(leads).toContain(`'${code}'`)
    expect(sql).toContain('public.has_org_permission')
    expect(sql).not.toContain('create table public.crm_permissions')
  })

  it('não hardcodeia nomes de stages nem vocabulário da operação legada', () => {
    for (const forbidden of ['novo lead', 'qualificado', 'proposta', 'negociação', 'ruah', 'perfume', 'davi', 'gabriel', 'emily']) {
      expect(sql.toLowerCase()).not.toContain(forbidden)
    }
    expect(pipelines).toContain("stage_type in ('open', 'won', 'lost')")
  })

  it('mantém attribution em leads e deals', () => {
    for (const source of [leads, deals]) {
      for (const field of ['source_channel', 'source_medium', 'source_campaign', 'source_external_id', 'attribution_metadata']) {
        expect(source).toContain(field)
      }
    }
  })
})

describe('CRM comercial — RLS e isolamento tenant', () => {
  it('habilita RLS em todas as tabelas novas', () => {
    for (const table of ['leads', 'pipelines', 'pipeline_stages', 'deals', 'deal_stage_history']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
    }
  })

  it('políticas de leitura exigem organização atual e permissão CRM', () => {
    expect(leads).toContain("organization_id in (select public.current_user_org_ids())")
    expect(leads).toContain("has_org_permission(organization_id, 'crm.leads.view')")
    expect(deals).toContain("has_org_permission(organization_id, 'crm.deals.view')")
    expect(history).toContain("has_org_permission(organization_id, 'crm.deals.view')")
  })

  it('lead rejeita company, contact e customer de outra organização', () => {
    for (const error of [
      'lead_company_organization_mismatch',
      'lead_contact_organization_mismatch',
      'lead_customer_organization_mismatch',
      'lead_converted_deal_organization_mismatch',
    ]) expect(deals + leads).toContain(error)
  })

  it('deal valida pipeline/stage e todas as relações opcionais contra o tenant', () => {
    for (const error of [
      'deal_pipeline_stage_organization_mismatch',
      'deal_customer_organization_mismatch',
      'deal_company_organization_mismatch',
      'deal_contact_organization_mismatch',
      'deal_lead_organization_mismatch',
    ]) expect(deals).toContain(error)
  })

  it('stage valida que seu pipeline pertence à mesma organização', () => {
    expect(pipelines).toContain('pipeline_stage_organization_mismatch')
    expect(pipelines).toContain('id = new.pipeline_id and organization_id = new.organization_id')
  })

  it('organization_id é imutável em todas as entidades comerciais mutáveis', () => {
    expect(leads).toContain('create or replace function public.crm_prevent_organization_change()')
    for (const trigger of [
      'leads_prevent_organization_change',
      'pipelines_prevent_organization_change',
      'pipeline_stages_prevent_organization_change',
      'deals_prevent_organization_change',
    ]) expect(sql).toContain(`create trigger ${trigger}`)
  })
})

describe('CRM comercial — pipelines e movimentação de deals', () => {
  it('garante no máximo um pipeline default ativo por organização', () => {
    expect(pipelines).toContain('create unique index pipelines_one_active_default_per_org_idx')
    expect(pipelines).toContain('where is_default and active')
  })

  it('move_deal_stage bloqueia concorrência e valida membership/permissão', () => {
    expect(history).toContain('where id = p_deal_id')
    expect(history).toContain('organization_id in (select public.current_user_org_ids())')
    expect(history).toContain('for update')
    expect(history).toContain('current_user_org_ids()')
    expect(history).toContain("has_org_permission(v_deal.organization_id, 'crm.deals.manage')")
  })

  it('aceita somente stage ativa do mesmo pipeline e tenant', () => {
    expect(history).toContain('organization_id = v_deal.organization_id')
    expect(history).toContain('pipeline_id = v_deal.pipeline_id')
    expect(history).toContain('and active')
  })

  it('registra cada mudança real em deal_stage_history', () => {
    expect(history).toContain('create trigger deals_record_stage_history')
    expect(history).toContain('old.stage_id is distinct from new.stage_id')
    expect(history).toContain('old.stage_id, new.stage_id, auth.uid()')
  })

  it('frontend movimenta stage pela RPC e não por update direto', () => {
    expect(dealMutations).toContain("rpc('move_deal_stage'")
    const updateDeal = dealMutations.slice(dealMutations.indexOf('export async function updateDeal'))
    expect(updateDeal).toContain('dealPayload(input, false)')
  })
})

describe('CRM comercial — timeline e extensões polimórficas', () => {
  it('entity_belongs_to_organization reconhece lead/deal e continua fail closed', () => {
    expect(history).toContain("when 'lead' then")
    expect(history).toContain("when 'deal' then")
    expect(history).toContain('v_found := false;')
  })

  it('tags, custom fields, notes e activities aceitam lead/deal', () => {
    for (const constraint of [
      'entity_tags_entity_type_check',
      'custom_fields_entity_type_check',
      'custom_field_values_entity_type_check',
      'notes_entity_type_check',
      'activities_entity_type_check',
    ]) {
      const start = history.indexOf(`add constraint ${constraint}`)
      const section = history.slice(start, history.indexOf(';', start))
      expect(section).toContain("'lead'")
      expect(section).toContain("'deal'")
    }
  })

  it('registra os cinco eventos comerciais solicitados', () => {
    for (const event of ['lead_created', 'deal_created', 'deal_stage_changed', 'deal_won', 'deal_lost']) {
      expect(history).toContain(`'${event}'`)
    }
  })
})

describe('CRM comercial — conversão de lead', () => {
  it('é transacional, bloqueia o lead e valida as duas permissões necessárias', () => {
    expect(conversion).toContain('where id = p_lead_id')
    expect(conversion).toContain('organization_id in (select public.current_user_org_ids())')
    expect(conversion).toContain('for update')
    expect(conversion).toContain("has_org_permission(v_lead.organization_id, 'crm.leads.manage')")
    expect(conversion).toContain("has_org_permission(v_lead.organization_id, 'crm.deals.manage')")
  })

  it('é idempotente e não cria duplicidade silenciosa em match ambíguo', () => {
    expect(conversion).toContain('if v_lead.converted_at is not null then')
    expect(conversion).toContain("'already_converted', true")
    expect(conversion).toContain('lead_customer_match_ambiguous')
    expect(conversion).toContain('lead_company_match_ambiguous')
    expect(conversion).toContain('lead_contact_match_ambiguous')
  })

  it('usa pipeline default/stage open configurados pelo tenant, sem criá-los implicitamente', () => {
    expect(conversion).toContain('is_default and active')
    expect(conversion).toContain("stage_type = 'open'")
    expect(conversion).toContain('default_pipeline_not_found')
    expect(conversion).not.toContain('insert into public.pipelines')
  })

  it('frontend expõe a conversão via RPC tipada', () => {
    expect(leadMutations).toContain("rpc('convert_lead'")
    expect(leadMutations).toContain('p_create_customer')
    expect(leadMutations).toContain('p_create_deal')
  })
})

describe('CRM comercial — SECURITY DEFINER e superfície pública', () => {
  it('todas as novas SECURITY DEFINER fixam search_path', () => {
    for (const source of [leads, pipelines, deals, history, conversion]) {
      const definitions = source.split(/create or replace function /).slice(1)
      for (const definition of definitions.filter((value) => value.includes('security definer'))) {
        expect(definition.slice(0, definition.indexOf('$$'))).toContain('set search_path = public')
      }
    }
  })

  it('helpers internos revogam PUBLIC, anon e authenticated', () => {
    for (const helper of [
      'leads_validate_tenant_refs()',
      'crm_prevent_organization_change()',
      'pipeline_stages_validate_tenant()',
      'deals_validate_tenant_refs()',
      'deals_record_stage_history()',
      'leads_log_activity()',
      'deals_log_activity()',
      'deals_log_stage_activity()',
    ]) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${helper.replace(/[()]/g, '\\$&')}[\\s\\S]*?from public, anon, authenticated;`))
    }
  })

  it('somente RPCs de negócio recebem grant authenticated explícito', () => {
    expect(history).toContain('grant execute on function public.move_deal_stage(uuid, uuid) to authenticated;')
    expect(conversion).toContain('to authenticated;')
    expect(sql.toLowerCase()).not.toContain('to service_role')
  })

  it('frontend não contém service_role nem implementação de Kanban', () => {
    expect(frontend.toLowerCase()).not.toContain('service_role')
    expect(frontend.toLowerCase()).not.toContain('kanban')
  })
})
