export type Membership={organization_id:string;role:string}
export type TenantResolution=
  |{ok:true;organizationId:string;role:string;source:'explicit'|'single_membership'}
  |{ok:false;code:'invalid_org'|'no_organization'|'organization_required'|'forbidden';status:400|403}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function resolveTenant(candidate:unknown,memberships:Membership[]):TenantResolution{
  const requested=String(candidate??'').trim()
  if(requested){
    if(!uuid.test(requested))return{ok:false,code:'invalid_org',status:400}
    const membership=memberships.find(item=>item.organization_id===requested)
    return membership?{ok:true,organizationId:membership.organization_id,role:membership.role,source:'explicit'}:{ok:false,code:'forbidden',status:403}
  }
  if(memberships.length===0)return{ok:false,code:'no_organization',status:403}
  if(memberships.length>1)return{ok:false,code:'organization_required',status:400}
  return{ok:true,organizationId:memberships[0].organization_id,role:memberships[0].role,source:'single_membership'}
}
