export const onlyDigits = (value:unknown) => String(value??'').replace(/\D/g,'')

export function normalizeBrazilianPhone(value:unknown) {
  const digits=onlyDigits(value)
  if(!digits)return null
  if(digits.length===10||digits.length===11)return `55${digits}`
  return digits
}

export const normalizeCpf = (value:unknown) => onlyDigits(value)||null
export const normalizePostalCode = (value:unknown) => onlyDigits(value)||null
export const normalizeState = (value:unknown) => String(value??'').trim().toUpperCase().slice(0,2)||null

