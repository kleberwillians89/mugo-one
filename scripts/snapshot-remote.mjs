import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import path from 'node:path'
import {inventoryBaseline} from './incremental-approved-decisions.mjs'

const projectRef='pfhvqkzafgoyumxmbwqc'
const outputDir=process.argv[2]||'private_data'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find((item)=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`
const headers={apikey:key,authorization:`Bearer ${key}`}
const request=async(url)=>{const response=await fetch(url,{headers});if(!response.ok)throw new Error(`Snapshot falhou: HTTP ${response.status}`);return response.json()}
const all=async(table)=>{const rows=[];for(let offset=0;;offset+=1000){const page=await request(`${base}/${table}?select=*&offset=${offset}&limit=1000`);rows.push(...page);if(page.length<1000)break}return rows}
const tables=['clients','sales','perfumes','inventory_items','inventory_movements','inventory_purchase_entries','inventory_allocations','shipments','preparation_batches','preparation_batch_items','shipment_items','shipment_events','incremental_import_staging','import_batches','import_rows','audit_logs']
const snapshot={created_at:new Date().toISOString(),project_ref:projectRef,tables:{}}
for(const table of tables)snapshot.tables[table]=await all(table)
const sales=snapshot.tables.sales
snapshot.baseline={
  clients:snapshot.tables.clients.length,sales:sales.length,perfumes:snapshot.tables.perfumes.length,
  ...inventoryBaseline(snapshot.tables),
  inventory_allocations:snapshot.tables.inventory_allocations.length,shipments:snapshot.tables.shipments.length,
  preparation_batches:snapshot.tables.preparation_batches.length,
  financial:Object.fromEntries(['paid','pending','cancelled','unknown'].map((status)=>[status,{
    rows:sales.filter((sale)=>sale.payment_status===status&&sale.deleted_at===null).length,
    amount:sales.filter((sale)=>sale.payment_status===status&&sale.deleted_at===null).reduce((sum,sale)=>sum+Number(sale.amount),0),
  }]))
}
mkdirSync(outputDir,{recursive:true})
const name=`supabase-snapshot-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
writeFileSync(path.join(outputDir,name),JSON.stringify(snapshot))
console.log(JSON.stringify({file:path.join(outputDir,name),baseline:snapshot.baseline},null,2))
