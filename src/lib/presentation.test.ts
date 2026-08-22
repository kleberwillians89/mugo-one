import {describe,expect,it} from 'vitest'
import {friendlyIntegrationError,operationalLabel} from './presentation'

describe('apresentação operacional em português',()=>{
  it.each([['draft','Rascunho'],['shipping','Em preparação para envio'],['reserved','Produto reservado'],['customer_approved','Aprovado pela cliente'],['quote_selected','Frete selecionado'],['shipment_created','Envio criado'],['review_required','Precisa de conferência'],['conference_assumed','Conferência assumida'],['conference_completed','Conferência concluída'],['recipient_snapshot_refreshed','Dados do destinatário atualizados']])('%s não vaza para a interface',(value,label)=>expect(operationalLabel(value)).toBe(label))
  it('oculta códigos técnicos da SuperFrete na mensagem principal',()=>expect(friendlyIntegrationError('SUPERFRETE_HTTP_400')).not.toContain('SUPERFRETE_HTTP_400'))
})
