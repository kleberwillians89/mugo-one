import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import path from 'node:path'

const input=process.argv[2],mode=process.argv[3]??'dry-run'
if(!input||!['dry-run','apply'].includes(mode))throw new Error('Uso: node scripts/apply-incremental-workbook.mjs arquivo.xlsx [dry-run|apply]')
const files=readdirSync('private_data').filter((name)=>name.startsWith('incremental-staging-')&&name.endsWith('.json')).sort()
if(!files.length)throw new Error('Execute analyze:incremental antes de aplicar.')
const staged=JSON.parse(readFileSync(path.join('private_data',files.at(-1)),'utf8'))
if(staged.report.source!==path.basename(input))throw new Error('Staging não corresponde ao arquivo informado.')
const recognized=staged.rows.filter((row)=>['existing_exact','existing_changed','new_safe','possible_duplicate','review_required','skipped_cancelled_source'].includes(row.classification))
if(recognized.length!==staged.report.total_lines)throw new Error('Staging incompleto.')
const approved=recognized.filter((row)=>['existing_changed','new_safe'].includes(row.classification))
const summary={source:path.basename(input),classification:{existing_exact:staged.report.existing_exact,existing_changed:staged.report.existing_changed,new_safe:staged.report.new_safe,possible_duplicate:staged.report.possible_duplicate,review_required:staged.report.review_required,skipped_cancelled_source:staged.report.skipped_cancelled_source},write_rows:approved.length,delta:staged.report.delta,mode}
if(mode==='dry-run'){console.log(JSON.stringify(summary,null,2));process.exit(0)}
const projectRef='pfhvqkzafgoyumxmbwqc',organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find((item)=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`,headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'}
const request=async(url,options={})=>{const response=await fetch(url,{...options,headers:{...headers,...options.headers}});const text=await response.text(),body=text?JSON.parse(text):null;if(!response.ok)throw new Error(body?.message??`HTTP ${response.status}`);return body}
const admins=await request(`${base}/organization_members?organization_id=eq.${organizationId}&role=eq.admin&select=user_id&limit=1`)
if(admins.length!==1)throw new Error('Administrador da organização não encontrado.')
const fileHash=createHash('sha256').update(readFileSync(input)).digest('hex')
const result=await request(`${base}/rpc/apply_incremental_commercial_batch`,{method:'POST',body:JSON.stringify({p_organization_id:organizationId,p_user_id:admins[0].user_id,p_file_name:path.basename(input),p_file_hash:fileHash,p_sheet_name:'PERFUMES',p_rows:approved})})
console.log(JSON.stringify({...summary,result},null,2))
