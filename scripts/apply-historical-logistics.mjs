import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const mode=process.argv[2]??'dry-run',files=fs.readdirSync('private_data').filter((x)=>x.startsWith('historical-logistics-staging-')).sort()
if(!['dry-run','apply'].includes(mode)||!files.length)throw new Error('Uso: node scripts/apply-historical-logistics.mjs [dry-run|apply]')
const staged=JSON.parse(fs.readFileSync(path.join('private_data',files.at(-1)),'utf8')),rows=staged.rows.filter((x)=>x.match_sale_id&&Object.keys(x.proposed).length>0).map((x)=>({sale_id:x.match_sale_id,source_row:x.source_row,proposed:x.proposed}))
const summary={mode,source:staged.report.source,source_hash:staged.report.source_sha256,updates:rows.length,fields:staged.report.safe_additions}
if(mode==='dry-run'){console.log(JSON.stringify(summary,null,2));process.exit(0)}
const projectRef='pfhvqkzafgoyumxmbwqc',organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea',keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'})),key=keys.find((x)=>x.name==='service_role'||x.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`,headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},request=async(url,options={})=>{const response=await fetch(url,{...options,headers:{...headers,...options.headers}}),text=await response.text(),body=text?JSON.parse(text):null;if(!response.ok)throw new Error(body?.message??`HTTP ${response.status}`);return body}
const admins=await request(`${base}/organization_members?organization_id=eq.${organizationId}&role=eq.admin&select=user_id&limit=1`),result=await request(`${base}/rpc/apply_historical_logistics_batch`,{method:'POST',body:JSON.stringify({p_organization_id:organizationId,p_user_id:admins[0].user_id,p_source_file:staged.report.source,p_source_hash:staged.report.source_sha256,p_source_snapshot:staged.report.snapshot,p_rows:rows,p_metadata:{prewrite_report:staged.report}})})
console.log(JSON.stringify({...summary,result},null,2))
