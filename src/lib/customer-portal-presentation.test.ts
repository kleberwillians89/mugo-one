import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { customerPortalErrorMessage } from './customer-portal'

const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')
const data=readFileSync('src/lib/customer-portal.ts','utf8')

describe('Minha RUAH customer-safe presentation',()=>{
  it('translates known custody conflicts',()=>expect(customerPortalErrorMessage(new Error('invalid_or_unavailable_custody'))).toBe('Este perfume já está vinculado a uma solicitação ou não está mais disponível para um novo envio.'))
  it.each(['invalid_status','permission_denied','PGRST116','42501','550e8400-e29b-41d4-a716-446655440000','shipment_item'])('never returns raw backend detail: %s',(raw)=>{const message=customerPortalErrorMessage(new Error(raw));expect(message).not.toContain(raw);expect(message).not.toMatch(/PGRST|42501|uuid|allocation|shipment_item/i)})
  it('routes rendered operation errors through the presentation layer',()=>{expect(portal).toContain('customerPortalErrorMessage(reason');expect(data).not.toMatch(/fetchCustody[\s\S]{0,240}throw new Error\(error\.message\)/);expect(data).not.toMatch(/createShipmentRequest[\s\S]{0,300}throw new Error\(error\.message\)/)})
})
