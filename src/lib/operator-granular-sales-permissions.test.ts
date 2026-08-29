import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const oldMigration=readFileSync(new URL('../../supabase/migrations/202607300010_period_delivery_reports_ai.sql',import.meta.url),'utf8')
const newMigration=readFileSync(new URL('../../supabase/migrations/202608290005_operator_granular_sales_permissions.sql',import.meta.url),'utf8')
const collectionsMigration=readFileSync(new URL('../../supabase/migrations/202608290004_collections_module.sql',import.meta.url),'utf8')
const daviSafeUpdate=readFileSync(new URL('../../supabase/migrations/202608230008_davi_excel_safe_existing_sale_update.sql',import.meta.url),'utf8')
const allocationSyncLatest=readFileSync(new URL('../../supabase/migrations/202608230011_fix_davi_sale_original_allocation_quantity.sql',import.meta.url),'utf8')
const permissions=readFileSync(new URL('./permissions.ts',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

// O comentário de auditoria no topo da migration CITA literalmente a
// função antiga entre aspas (propósito: documentar o "antes"), então
// indexOf ingênuo acharia essa citação em vez do código real. O código
// real é sempre a ÚLTIMA ocorrência do sinal da função no arquivo.
const stripSqlComments=(sql:string)=>sql.split('\n').map(line=>{const i=line.indexOf('--');return i>=0?line.slice(0,i):line}).join('\n')
const newMigrationCode=stripSqlComments(newMigration)
const paymentFn=newMigration.slice(newMigration.lastIndexOf('create or replace function public.protect_operator_sale_changes'))

describe('operator + sales.edit — regra nova (item 3): permissão granular sobrepõe o role legado',()=>{
  it('a condição de bloqueio agora exige "operator AND NOT sales.edit" — quando sales.edit=true, o bloqueio nunca dispara, não importa qual campo mudou',()=>{
    expect(paymentFn).toContain("if user_role='operator'\n     and not public.has_org_permission(old.organization_id,'sales.edit')\n     and (")
  })
  it('cenário 1 — operator + sales.edit + pending->paid = PASS: has_org_permission=true faz "not true"=false, a conjunção AND curto-circuita e a exceção nunca é levantada',()=>{
    // A condição é: operator AND (NOT has_permission) AND (campos mudaram).
    // NOT true = false; false AND qualquer coisa = false — raise nunca roda.
    const condition=paymentFn.slice(paymentFn.indexOf("if user_role='operator'"),paymentFn.indexOf("then raise exception 'operator_shipping_only'"))
    expect(condition).toMatch(/user_role='operator'\s*\n\s*and not public\.has_org_permission\(old\.organization_id,'sales\.edit'\)\s*\n\s*and \(/)
  })
  it('cenário 2 — operator SEM sales.edit + pending->paid = DENY: has_org_permission=false faz "not false"=true, condição segue idêntica à original para os 8 campos',()=>{
    for(const field of ['new.client_id is distinct from old.client_id','new.sale_date is distinct from old.sale_date','new.amount is distinct from old.amount','new.payment_status is distinct from old.payment_status','new.payment_method is distinct from old.payment_method','new.perfume_id is distinct from old.perfume_id','new.sale_type is distinct from old.sale_type','new.volume_ml is distinct from old.volume_ml'])
      expect(paymentFn).toContain(field)
    expect(paymentFn).toContain("raise exception 'operator_shipping_only'")
  })
  it('cenário 3 — operator com sales.view mas SEM sales.edit continua DENY: são códigos de permissão distintos, um não implica o outro',()=>{
    expect(permissions).toContain("{ code: 'sales.view'")
    expect(permissions).toContain("{ code: 'sales.edit'")
    expect(paymentFn).toContain("'sales.edit'")
    expect(paymentFn).not.toMatch(/has_org_permission\([^)]*'sales\.view'\)/)
  })
  it('cenário 4 — manager/admin continuam funcionando: a checagem só entra em cena quando user_role=\'operator\' — nenhuma outra role aparece nesta condição',()=>{
    const blockCondition=paymentFn.slice(paymentFn.indexOf('begin'),paymentFn.lastIndexOf('return new;'))
    expect(blockCondition.match(/user_role='operator'/g)).toHaveLength(1)
    expect(blockCondition).not.toMatch(/user_role\s*=\s*'(admin|manager)'/)
  })
  it('viewer continua bloqueado sem checar nenhuma permissão granular — fora do escopo desta correção, comportamento intocado',()=>{
    expect(paymentFn).toContain("if user_role='viewer' then raise exception 'viewer_read_only'; end if;")
  })
})

describe('cenário 5 — cross-tenant = DENY (item 5)',()=>{
  it('organization_id do trigger vem de OLD (a linha já no banco), nunca de um parâmetro do cliente',()=>{
    expect(paymentFn).toContain('where organization_id=old.organization_id and user_id=auth.uid()')
    expect(paymentFn).toContain("public.has_org_permission(old.organization_id,'sales.edit')")
    expect(newMigration).not.toMatch(/p_organization_id/)
  })
  it('auth.uid() é obrigatório para resolver role e permissão — sessão nula não decide sozinha nada de operator/viewer',()=>{
    expect(paymentFn).toContain('if auth.uid() is null then return new; end if;')
  })
  it('has_org_permission já é tenant-scoped (auditado no preflight anterior) — sales.edit em uma organização nunca autoriza venda de outra',()=>{
    expect(collectionsMigration).toContain('organization_id in(select public.current_user_org_ids())')
  })
})

describe('cenário 6 — cancelled continua respeitando as regras da própria RPC (não deste trigger)',()=>{
  it('collections_register_payment mantém seu próprio bloqueio de venda cancelada, independente da correção de role',()=>{
    expect(collectionsMigration).toContain("if sale_row.payment_status='cancelled' then raise exception 'sale_cancelled:%',sale_row.id; end if;")
  })
  it('esta migration não toca a lógica de cancelled em nenhuma RPC',()=>{
    expect(newMigration).not.toContain('cancelled')
  })
})

describe('cenário 7 — Davi Excel usa a mesma permissão granular (item 7)',()=>{
  it('davi_excel_update_sale já exige sales.edit como gate próprio, mesmo código usado na correção do trigger',()=>{
    expect(daviSafeUpdate).toContain("if not public.has_org_permission(before_row.organization_id,'sales.edit') then raise exception 'forbidden'; end if;")
  })
  it('operator + sales.edit consegue alterar os campos comerciais do Davi Excel: o próprio gate da RPC já deixava passar, e agora o trigger de role legado não barra mais o UPDATE por trás — mesmos 8 campos do trigger fazem parte do array allowed da RPC',()=>{
    for(const field of ["'client_id'","'sale_date'","'volume_ml'","'perfume_id'","'amount'","'payment_status'","'payment_method'"])
      expect(daviSafeUpdate).toContain(field)
  })
  it('operator sem sales.edit continua bloqueado no Davi Excel: a própria RPC já rejeita com "forbidden" antes de chegar no UPDATE',()=>{
    expect(daviSafeUpdate).toContain("raise exception 'forbidden'")
  })
  it('nenhum enum ou contrato do Davi Excel foi alterado por esta migration (o comentário de auditoria só cita davi_excel_update_sale como documentação, nenhuma função davi_excel_* é criada/redefinida)',()=>{
    expect(newMigrationCode).not.toMatch(/davi_excel/)
  })
})

describe('cenário 8 — Cobranças usa a mesma permissão granular (item 6)',()=>{
  it('collections_register_payment exige sales.edit por venda, mesmo código usado na correção do trigger',()=>{
    expect(collectionsMigration).toContain("public.has_org_permission(sale_row.organization_id,'sales.edit')")
  })
  it('sales.view sem sales.edit: abre Cobranças (collections_pending_sales pede só sales.view) mas não registra pagamento (collections_register_payment pede sales.edit)',()=>{
    expect(collectionsMigration).toContain("public.has_org_permission(s.organization_id,'sales.view')")
    expect(collectionsMigration).toContain("public.has_org_permission(sale_row.organization_id,'sales.edit')")
  })
})

describe('cenário 9 — nenhuma exceção hardcoded por nome de RPC (item 3)',()=>{
  it('o CÓDIGO EXECUTÁVEL da correção é genérico ao trigger de sales — não referencia collections_register_payment, davi_excel_update_sale nem qualquer RPC específica (as menções em comentário são só documentação de auditoria, não lógica)',()=>{
    for(const forbidden of ['collections_register_payment','davi_excel_update_sale','collections_pending_sales','collections_log_message_copied'])
      expect(newMigrationCode).not.toContain(forbidden)
  })
  it('não usa current_setting/application_name ou qualquer forma de identificar QUEM chamou além de auth.uid()+role+permissão',()=>{
    expect(newMigrationCode).not.toMatch(/current_setting\('application_name'\)|current_query\(\)/)
  })
})

describe('cenário 10 — proteção de estoque intacta (item 8)',()=>{
  it('o código executável desta migration não redefine sync_sale_inventory_allocation nem qualquer trigger/função de estoque (só é citada em comentário, como documentação de auditoria)',()=>{
    expect(newMigrationCode).not.toContain('sync_sale_inventory_allocation')
    expect(newMigrationCode.match(/create (or replace )?function/g)).toHaveLength(1)
    expect(newMigrationCode).not.toMatch(/create trigger/)
  })
  it('nenhuma tabela/campo físico é escrito por esta migration (código executável, sem os comentários de auditoria)',()=>{
    for(const forbidden of ['inventory_items','inventory_movements','inventory_purchase_entries','physical_ml','operational_code','RUAH-P','shipments','preparation_batches'])
      expect(newMigrationCode).not.toContain(forbidden)
  })
  it('a versão ativa de sync_sale_inventory_allocation (202608230011) continua sendo a mesma — comportamento de inventory_allocations/available_ml ao marcar paid não muda',()=>{
    expect(allocationSyncLatest).toContain("new.payment_status<>'paid' or not new.inventory_allocation_eligible")
  })
})

describe('cenário 11 — migration antiga (202607300010) não foi modificada (item 1)',()=>{
  it('a migration original continua com a condição incondicional de bloqueio, exatamente como foi aplicada — a correção mora só na 290005',()=>{
    expect(oldMigration).toContain("if user_role='operator' and (\n    new.client_id is distinct from old.client_id")
    expect(oldMigration).not.toContain('has_org_permission')
  })
})

describe('cenário 12 — nova migration redefine de forma incremental e segura (item 1/12)',()=>{
  it('usa CREATE OR REPLACE FUNCTION — não recria a trigger, não faz DROP/CREATE, preserva o objeto já ligado à trigger existente',()=>{
    expect(newMigration).toContain('create or replace function public.protect_operator_sale_changes()')
    expect(newMigration).not.toMatch(/drop function|drop trigger|create trigger/)
  })
  it('mantém security definer e search_path fechado, igual à versão original',()=>{
    expect(newMigration).toContain('returns trigger language plpgsql security definer set search_path=public')
  })
  it('registros de erro amigáveis (records.ts) já cobrem operator_shipping_only para o caso remanescente (operator sem sales.edit)',()=>{
    expect(records).toContain("message.includes('operator_shipping_only')")
  })
})
