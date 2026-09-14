import{execFileSync}from'node:child_process'

const projectRef='pfhvqkzafgoyumxmbwqc'
const organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find(item=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`,headers={apikey:key,authorization:`Bearer ${key}`}
const request=async path=>{const response=await fetch(base+path,{headers});if(!response.ok)throw new Error(`HTTP ${response.status}: ${await response.text()}`);return response.json()}
const all=async(path)=>{const rows=[];for(let offset=0;;offset+=1000){const page=await request(`${path}${path.includes('?')?'&':'?'}offset=${offset}&limit=1000`);rows.push(...page);if(page.length<1000)return rows}}
const[sales,items,births,allocations,batches,movements,perfumes]=await Promise.all([
  all(`/sales?organization_id=eq.${organizationId}&sale_date=gte.2026-09-04&deleted_at=is.null&select=id,perfume_id,sale_date,sale_type,volume_ml,payment_status,source,import_signature,inventory_item_id,inventory_allocation_eligible`),
  all(`/inventory_items?organization_id=eq.${organizationId}&select=id,perfume_id,reference_date,available_ml,physical_ml,status,reconciliation_status,notes`),
  all(`/sale_inventory_births?organization_id=eq.${organizationId}&select=id,source_key,perfume_id,inventory_item_id,bottle_identifier,available_ml,created_at`),
  all(`/inventory_allocations?organization_id=eq.${organizationId}&select=id,sale_id,perfume_id,inventory_item_id,quantity_ml,status,allocation_source,stock_managed`),
  all(`/ai_sales_batches?organization_id=eq.${organizationId}&sale_date=gte.2026-09-04&select=id,fingerprint,perfume_id,perfume_name,bottle_number,sale_date,sales_count,total_ml,announced_balance_ml,status,result,source_text,created_at`),
  all(`/inventory_movements?organization_id=eq.${organizationId}&select=id,inventory_item_id,perfume_id,movement_type,quantity_ml,balance_before,balance_after,origin,reason,created_at`),
  all(`/perfumes?organization_id=eq.${organizationId}&select=id,full_name_raw`),
])
const names=new Map(perfumes.map(row=>[row.id,row.full_name_raw]))
const grouped=new Map()
const group=id=>{if(!grouped.has(id))grouped.set(id,{perfume_id:id,perfume:names.get(id)??'(sem perfume)',sales:0,sold_ml:0,paid_ml:0,pending_ml:0,ai_sales_ml:0,birth_ml:0,allocated_ml:0,inventory_available_ml:null,inventory_physical_ml:null,movements:0,manual_adjustment_ml:0,batches:0});return grouped.get(id)}
for(const sale of sales){const row=group(sale.perfume_id);row.sales++;row.sold_ml+=Number(sale.volume_ml??0);row[`${sale.payment_status}_ml`]=(row[`${sale.payment_status}_ml`]??0)+Number(sale.volume_ml??0);if(sale.source==='ai_sales_batch')row.ai_sales_ml+=Number(sale.volume_ml??0)}
for(const birth of births)group(birth.perfume_id).birth_ml+=Number(birth.available_ml??0)
for(const allocation of allocations){if(['reserved','shipping','shipped'].includes(allocation.status))group(allocation.perfume_id).allocated_ml+=Number(allocation.quantity_ml??0)}
for(const item of items){const row=group(item.perfume_id);row.inventory_available_ml=Number(item.available_ml);row.inventory_physical_ml=Number(item.physical_ml);row.inventory_item_id=item.id;row.reconciliation_status=item.reconciliation_status}
for(const batch of batches)group(batch.perfume_id).batches++
for(const movement of movements){const row=group(movement.perfume_id);row.movements++;if(!['validated_sale_remainder','validated_sale_backfill','validated_sale_repair'].includes(movement.origin))row.manual_adjustment_ml+=Number(movement.quantity_ml??0)}
const rows=[...grouped.values()].map(row=>({...row,sold_ml:+row.sold_ml.toFixed(3),paid_ml:+row.paid_ml.toFixed(3),pending_ml:+row.pending_ml.toFixed(3),birth_ml:+row.birth_ml.toFixed(3),allocated_ml:+row.allocated_ml.toFixed(3),manual_adjustment_ml:+row.manual_adjustment_ml.toFixed(3),difference_from_birth:row.inventory_available_ml===null?null:+(row.inventory_available_ml-row.birth_ml).toFixed(3)})).sort((a,b)=>a.perfume.localeCompare(b.perfume,'pt-BR'))
console.log(JSON.stringify({counts:{sales:sales.length,items:items.length,births:births.length,allocations:allocations.length,batches:batches.length,movements:movements.length},rows},null,2))
