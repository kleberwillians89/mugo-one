import {readFileSync} from 'node:fs'

const label=readFileSync('supabase/functions/superfrete-create-label/index.ts','utf8')
const shared=readFileSync('supabase/functions/_shared/superfrete.ts','utf8')
const frontend=readFileSync('src/lib/records.ts','utf8')
const assertions=[
  ['cart somente na função de emissão',label.includes("'/api/v0/cart'")],
  ['checkout somente na função de emissão',label.includes("'/api/v0/checkout'")],
  ['claim transacional antes do cart',label.indexOf('claim_superfrete_cart')<label.indexOf("'/api/v0/cart'")],
  ['persistência do order antes do checkout',label.indexOf('complete_superfrete_cart')<label.indexOf("'/api/v0/checkout'")],
  ['timeout marcado como incerto',label.includes("safe.uncertain?'uncertain':'failed'")],
  ['token lido exclusivamente no backend',shared.includes("Deno.env.get('SUPERFRETE_TOKEN')")&&!frontend.includes('SUPERFRETE_TOKEN')],
  ['frontend chama Edge Function',frontend.includes("functions.invoke(name")],
  ['frontend não chama API SuperFrete',!frontend.includes('api.superfrete.com')],
]
const failed=assertions.filter(([,ok])=>!ok)
for(const [name,ok]of assertions)console.log(`${ok?'PASS':'FAIL'} ${name}`)
if(failed.length)process.exit(1)
