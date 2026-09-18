import { useEffect, useState } from 'react'
import { authenticatedOrganization } from '../lib/records'
import { fetchOrganizationSettings } from '../core/organizations/organizationSettings'

export type OrganizationBrand = { logoUrl: string | null; companyName: string }
const NEUTRAL_BRAND: OrganizationBrand = { logoUrl: null, companyName: 'Mugô One' }

/**
 * Busca a marca REAL da organização (logo/nome) — nunca hardcoded (ver
 * docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md). Sem logo configurado, o
 * fallback é o próprio logo neutro do produto (/mugo-logo.png, já usado
 * no rodapé do app em App.tsx) — nunca uma marca de organização
 * específica.
 */
export function useOrganizationBrand(): OrganizationBrand {
  const [brand, setBrand] = useState<OrganizationBrand>(NEUTRAL_BRAND)
  useEffect(() => {
    let cancelled = false
    authenticatedOrganization()
      .then(({ organizationId }) => fetchOrganizationSettings(organizationId))
      .then((settings) => {
        if (cancelled || !settings) return
        setBrand({ logoUrl: settings.logo_url || null, companyName: settings.company_name || settings.legal_name || 'Mugô One' })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return brand
}

/**
 * <img> puro (nunca um wrapper novo) para reaproveitar o CSS existente
 * de .org-brand-mark/.org-brand-mark-print (ver src/enhancements.css,
 * renomeado de .ruah-brand/.ruah-brand-print nesta sprint) sem precisar
 * reajustar layout em Envio 360/Central de Etiqueta. Recebe `brand`
 * pronto — nunca busca sozinho: quem captura a imagem (ex.:
 * CollectionSummaryImageCard) precisa do dado já resolvido ANTES da
 * captura (html-to-image), sem correr contra um fetch assíncrono
 * disparado no próprio mount.
 */
export function OrganizationBrandMark({ print = false, brand }: { print?: boolean; brand: OrganizationBrand }) {
  return (
    <img
      className={`org-brand-mark ${print ? 'org-brand-mark-print' : ''}`}
      src={brand.logoUrl ?? '/mugo-logo.png'}
      alt={brand.companyName}
    />
  )
}

/** Versão que busca a própria marca (useOrganizationBrand) — para telas comuns (não-captura), como Envio 360/Central de Etiqueta. */
export function AutoOrganizationBrandMark({ print = false }: { print?: boolean }) {
  const brand = useOrganizationBrand()
  return <OrganizationBrandMark print={print} brand={brand}/>
}
