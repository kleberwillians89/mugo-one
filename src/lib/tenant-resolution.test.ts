import {describe,expect,it} from 'vitest'
import {resolveTenant} from '../../supabase/functions/_shared/tenant-resolution'

const orgA='11111111-1111-4111-8111-111111111111',orgB='22222222-2222-4222-8222-222222222222'
const one=[{organization_id:orgA,role:'admin'}],many=[...one,{organization_id:orgB,role:'operator'}]
describe('resolução segura do tenant no parse de lote',()=>{
  it('aceita usuário com uma organização válida',()=>expect(resolveTenant(orgA,one)).toMatchObject({ok:true,organizationId:orgA,role:'admin'}))
  it('aceita organization_id correto',()=>expect(resolveTenant(orgB,many)).toMatchObject({ok:true,organizationId:orgB}))
  it('resolve organization_id ausente somente com uma membership',()=>expect(resolveTenant(undefined,one)).toMatchObject({ok:true,organizationId:orgA,source:'single_membership'}))
  it('rejeita organization_id inválido',()=>expect(resolveTenant('ruah',one)).toEqual({ok:false,code:'invalid_org',status:400}))
  it('rejeita UUID de outra organização',()=>expect(resolveTenant(orgB,one)).toEqual({ok:false,code:'forbidden',status:403}))
  it('rejeita usuário sem organização',()=>expect(resolveTenant(undefined,[])).toEqual({ok:false,code:'no_organization',status:403}))
  it('não escolhe arbitrariamente em multiorganização',()=>expect(resolveTenant(undefined,many)).toEqual({ok:false,code:'organization_required',status:400}))
})
