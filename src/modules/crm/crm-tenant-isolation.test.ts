import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const base = (name: string) => new URL(`../../../supabase/migrations/${name}`, import.meta.url)

const customers = readFileSync(base('202609180001_crm_customers_generalization.sql'), 'utf8')
const companiesContacts = readFileSync(base('202609180002_crm_companies_contacts.sql'), 'utf8')
const tags = readFileSync(base('202609180003_crm_tags.sql'), 'utf8')
const customFields = readFileSync(base('202609180004_crm_custom_fields.sql'), 'utf8')
const notesActivities = readFileSync(base('202609180005_crm_notes_activities.sql'), 'utf8')

const all = [companiesContacts, tags, customFields, notesActivities].join('\n')

/**
 * Guarda de regressão estática (mesmo estilo de
 * src/core/organizations/multi-tenant-isolation.test.ts): sem banco de
 * teste conectado neste ambiente, verificamos por inspeção do SQL que
 * toda tabela nova segue o padrão de RLS já comprovado no legado
 * (current_user_org_ids para leitura, has_org_role para escrita) e que
 * toda referência entre tabelas (contacts→companies/clients,
 * entity_tags/custom_field_values/notes/activities→qualquer entidade)
 * é validada contra a organização antes de aceitar a linha — nunca só
 * pela FK, que sozinha não garante isolamento entre tenants.
 */
describe('CRM universal — RLS habilitado em todas as tabelas novas', () => {
  it('companies, contacts, tags, entity_tags, custom_fields, custom_field_values, notes e activities têm RLS habilitado', () => {
    const tables = [
      'companies',
      'contacts',
      'tags',
      'entity_tags',
      'custom_fields',
      'custom_field_values',
      'notes',
      'activities',
    ]
    for (const table of tables) {
      expect(all).toContain(`alter table public.${table} enable row level security`)
    }
  })
})

describe('CRM universal — toda policy de SELECT restringe por organização', () => {
  it('cada policy _org_select usa current_user_org_ids()', () => {
    const selectPolicies = all.match(/create policy \w*_?org_select[\s\S]*?;/g) ?? []
    expect(selectPolicies.length).toBeGreaterThanOrEqual(8)
    for (const policy of selectPolicies) {
      expect(policy).toContain('current_user_org_ids()')
    }
  })
})

describe('CRM universal — toda policy de escrita exige papel admin/manager/operator da própria organização', () => {
  it('cada policy _org_write usa has_org_role com organization_id da própria linha', () => {
    const writePolicies = all.match(/create policy \w*_?org_write[\s\S]*?;/g) ?? []
    // companies, contacts, tags, entity_tags, custom_fields, custom_field_values, notes = 7
    // (activities não tem policy de write — só log_activity(), ver teste dedicado abaixo)
    expect(writePolicies.length).toBe(7)
    for (const policy of writePolicies) {
      expect(policy).toContain("has_org_role(organization_id, array['admin','manager','operator']::public.member_role[])")
    }
  })
})

describe('CRM universal — activities só é escrita via log_activity() (SECURITY DEFINER), nunca por INSERT direto', () => {
  it('não existe policy de insert/all para authenticated em activities, só select', () => {
    const activitiesSection = notesActivities.slice(notesActivities.indexOf('create table public.activities'))
    expect(activitiesSection).toContain('create policy activities_org_select')
    expect(activitiesSection).not.toContain('activities_org_write')
    expect(activitiesSection).not.toMatch(/grant[^;]*insert[^;]*on public\.activities/i)
  })

  it('log_activity() é security definer e valida a entidade antes de inserir', () => {
    const start = notesActivities.indexOf('create or replace function public.log_activity(')
    const end = notesActivities.indexOf('$$;', start)
    const fn = notesActivities.slice(start, end)
    expect(fn).toContain('security definer')
    expect(fn).toContain('entity_belongs_to_organization(p_entity_type, p_entity_id, p_organization_id)')
  })
})

describe('CRM universal — validação polimórfica de entity_type/entity_id nunca confia só na FK', () => {
  it('entity_belongs_to_organization nega por padrão tipos que não sabe validar (fail closed)', () => {
    expect(tags).toContain('v_found := false;')
    expect(tags).toContain('return coalesce(v_found, false);')
  })

  it('entity_type é restrito a customer/company/contact em entity_tags, custom_fields, custom_field_values e notes/activities (nada de deal/task/product/sale antes de existirem)', () => {
    const entityTypeChecks = [tags, customFields, notesActivities].join('\n').match(/entity_type text not null check \(entity_type in \([^)]*\)\)/g) ?? []
    expect(entityTypeChecks.length).toBeGreaterThanOrEqual(4)
    for (const check of entityTypeChecks) {
      expect(check).toContain("'customer'")
      expect(check).toContain("'company'")
      expect(check).toContain("'contact'")
      expect(check).not.toContain("'deal'")
      expect(check).not.toContain("'task'")
      expect(check).not.toContain("'product'")
      expect(check).not.toContain("'sale'")
    }
  })

  it('entity_tags valida tanto a entidade quanto a própria tag contra a organização', () => {
    expect(tags).toContain('create trigger entity_tags_validate_tenant_ownership')
    expect(tags).toContain('create trigger entity_tags_validate_tag_tenant')
    expect(tags).toContain('entity_tag_tag_organization_mismatch')
  })

  it('custom_field_values valida o custom_field, o entity_type declarado e a entidade alvo', () => {
    expect(customFields).toContain('custom_field_organization_mismatch')
    expect(customFields).toContain('custom_field_entity_type_mismatch')
    expect(customFields).toContain('entity_belongs_to_organization(new.entity_type, new.entity_id, new.organization_id)')
  })

  it('notes valida a entidade alvo antes de aceitar a linha', () => {
    expect(notesActivities).toContain('create trigger notes_validate_tenant_ownership')
  })
})

describe('CRM universal — contacts não aceita vínculo com company/customer de outra organização', () => {
  it('contacts_validate_tenant_refs checa organization_id tanto de company_id quanto de customer_id', () => {
    const start = companiesContacts.indexOf('create or replace function public.contacts_validate_tenant_refs')
    const end = companiesContacts.indexOf('$$;', start)
    const fn = companiesContacts.slice(start, end)
    expect(fn).toContain('contact_company_organization_mismatch')
    expect(fn).toContain('contact_customer_organization_mismatch')
    expect(fn).toContain('organization_id = new.organization_id')
  })

  it('o trigger está de fato anexado à tabela contacts', () => {
    expect(companiesContacts).toContain('create trigger contacts_validate_tenant_refs')
  })
})

describe('CRM universal — generalização de clients (customer) é só aditiva', () => {
  it('nenhuma coluna, policy ou trigger existente de clients foi removida ou substituída', () => {
    expect(customers).toContain('add column if not exists')
    expect(customers).not.toMatch(/drop column|drop constraint|drop trigger|drop policy/i)
  })

  it('mantém o source original (não redefine a coluna) e só adiciona detalhamento de atribuição', () => {
    expect(customers).not.toMatch(/add column\s+(if not exists\s+)?source\s/)
    expect(customers).toContain('source_channel')
    expect(customers).toContain('source_campaign')
    expect(customers).toContain('attribution_metadata')
  })
})

describe('CRM universal — nenhum arquivo novo referencia SERVICE_ROLE, RUAH, perfume ou pessoas específicas', () => {
  it('migrations novas não têm hardcode de tenant único ou vocabulário de perfumaria', () => {
    for (const source of [customers, companiesContacts, tags, customFields, notesActivities]) {
      expect(source.toLowerCase()).not.toContain('ruah')
      expect(source.toLowerCase()).not.toContain('perfume')
      expect(source).not.toContain('SERVICE_ROLE')
    }
  })
})
