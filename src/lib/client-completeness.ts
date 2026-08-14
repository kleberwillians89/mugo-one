export type ShippingClientFields = {
  phone?: string | null; whatsapp_phone?: string | null
  cpf?: string | null; cnpj?: string | null
  postal_code?: string | null; address_line?: string | null; address_number?: string | null
  district?: string | null; city?: string | null; state?: string | null
}

// Order matches the fields a shipment actually needs, most-blocking first.
// Only fields that are genuinely absent are ever returned — never invents
// or assumes a value.
export function missingShippingClientFields(client: ShippingClientFields): string[] {
  const checks: [boolean, string][] = [
    [!client.phone && !client.whatsapp_phone, 'Telefone'],
    [!client.cpf && !client.cnpj, 'CPF'],
    [!client.postal_code, 'CEP'],
    [!client.address_line, 'Endereço'],
    [!client.address_number, 'Número'],
    [!client.district, 'Bairro'],
    [!client.city, 'Cidade'],
    [!client.state, 'Estado'],
  ]
  return checks.filter(([missing]) => missing).map(([, label]) => label)
}
