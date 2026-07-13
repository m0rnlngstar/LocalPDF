import { openPdf } from '../../lib/pdfjs'

/**
 * Extraction et lecture d'une facture électronique Factur-X (norme AFNOR
 * XP Z12-012 / EN 16931) : un PDF/A-3 contenant un XML CII
 * (« Cross Industry Invoice ») en pièce jointe, généralement `factur-x.xml`.
 *
 * Le parsing est volontairement tolérant : on navigue dans le XML par nom
 * local (sans se soucier des préfixes de namespace rsm:/ram:/udt:) et chaque
 * champ absent vaut simplement `null` — c'est ensuite le module de contrôles
 * (checks.ts) qui décide de ce qui est bloquant.
 */

/** Noms de fichiers XML admis par les différentes versions de la norme. */
const XML_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'order-x.xml']

export const PROFILES: { urn: string; label: string }[] = [
  { urn: 'urn:factur-x.eu:1p0:minimum', label: 'MINIMUM' },
  { urn: 'urn:factur-x.eu:1p0:basicwl', label: 'BASIC WL' },
  { urn: 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic', label: 'BASIC' },
  { urn: 'urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended', label: 'EXTENDED' },
  { urn: 'urn:cen.eu:en16931:2017', label: 'EN 16931' },
]

/** Codes de type de document usuels (BT-3, liste UNTDID 1001). */
export const TYPE_CODES: Record<string, string> = {
  '380': 'Facture',
  '381': 'Avoir',
  '384': 'Facture rectificative',
  '386': "Facture d'acompte",
  '389': 'Auto-facturation',
  '261': 'Avoir auto-facturé',
  '751': "Facture — informations comptables (usage France)",
}

export interface TradeParty {
  name: string | null
  siren: string | null
  siret: string | null
  vatId: string | null
  address: string | null
  country: string | null
}

export interface VatLine {
  rate: number | null
  categoryCode: string | null
  basis: number | null
  amount: number | null
}

export interface InvoiceLine {
  id: string | null
  name: string | null
  quantity: number | null
  unitCode: string | null
  unitPrice: number | null
  vatRate: number | null
  total: number | null
}

export interface InvoiceData {
  profileUrn: string | null
  profileLabel: string | null
  number: string | null
  typeCode: string | null
  issueDate: string | null // brut, format 102 = AAAAMMJJ
  currency: string | null
  buyerReference: string | null
  orderReference: string | null
  seller: TradeParty
  buyer: TradeParty
  vatBreakdown: VatLine[]
  lines: InvoiceLine[]
  paymentTerms: string | null
  dueDate: string | null
  iban: string | null
  notes: string[]
  totals: {
    lineTotal: number | null
    taxBasis: number | null
    tax: number | null
    grand: number | null
    prepaid: number | null
    due: number | null
  }
}

export interface ExtractionResult {
  xmlFilename: string | null
  xml: string | null
  /** Autres pièces jointes trouvées dans le PDF. */
  otherAttachments: string[]
  /** Le XMP du PDF déclare-t-il PDF/A-3 ? null = indéterminable. */
  pdfA3: boolean | null
  pageCount: number
}

/** Extrait la pièce jointe XML et les métadonnées PDF/A du PDF. */
export async function extractFacturX(bytes: ArrayBuffer): Promise<ExtractionResult> {
  const pdf = await openPdf(bytes)
  // pdf.js ≥ v6 : les métadonnées et le contenu des pièces jointes sont séparés
  const attachments = await pdf.getAttachments()

  let xmlFilename: string | null = null
  let xml: string | null = null
  const otherAttachments: string[] = []

  if (attachments) {
    const entries = [...attachments.entries()]
    const match =
      entries.find(([, a]) => XML_NAMES.includes(a.filename.toLowerCase())) ??
      entries.find(([, a]) => a.filename.toLowerCase().endsWith('.xml'))
    for (const [, a] of entries) {
      if (a === match?.[1]) continue
      otherAttachments.push(a.filename)
    }
    if (match) {
      const [id, a] = match
      xmlFilename = a.filename
      const content = a.content ?? (await pdf.getAttachmentContent(id))
      if (content) xml = new TextDecoder('utf-8').decode(content)
    }
  }

  // Détection PDF/A-3 via le XMP (déclaratif : on ne valide pas le PDF/A lui-même)
  let pdfA3: boolean | null = null
  try {
    const meta = await pdf.getMetadata()
    const raw: string | null = meta.metadata?.getRaw() ?? null
    if (raw) pdfA3 = /pdfaid:part\s*(?:=\s*"|>\s*)3/.test(raw)
  } catch {
    pdfA3 = null
  }

  const pageCount = pdf.numPages
  void pdf.cleanup()
  return { xmlFilename, xml, otherAttachments, pdfA3, pageCount }
}

// ---------------------------------------------------------------------------
// Navigation XML par nom local (indépendante des préfixes de namespace)
// ---------------------------------------------------------------------------

function child(el: Element | null, name: string): Element | null {
  if (!el) return null
  for (const c of el.children) if (c.localName === name) return c
  return null
}

function childs(el: Element | null, name: string): Element[] {
  if (!el) return []
  return [...el.children].filter((c) => c.localName === name)
}

/** Descend une suite de noms locaux depuis `el`. */
function path(el: Element | null, ...names: string[]): Element | null {
  let cur = el
  for (const n of names) cur = child(cur, n)
  return cur
}

const text = (el: Element | null): string | null => el?.textContent?.trim() || null
const num = (el: Element | null): number | null => {
  const t = text(el)
  if (t === null) return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

function parseParty(el: Element | null): TradeParty {
  const legalId = path(el, 'SpecifiedLegalOrganization', 'ID')
  const scheme = legalId?.getAttribute('schemeID')
  const legal = text(legalId)
  // schemeID 0002 = SIREN, 0009 = SIRET (codelist ISO 6523)
  const siren = scheme === '0002' ? legal : scheme === '0009' && legal ? legal.slice(0, 9) : null
  const siret = scheme === '0009' ? legal : null

  const vatId = childs(el, 'SpecifiedTaxRegistration')
    .map((r) => child(r, 'ID'))
    .find((id) => id?.getAttribute('schemeID') === 'VA')

  const addr = child(el, 'PostalTradeAddress')
  const addressParts = [
    text(child(addr, 'LineOne')),
    text(child(addr, 'LineTwo')),
    [text(child(addr, 'PostcodeCode')), text(child(addr, 'CityName'))].filter(Boolean).join(' '),
  ].filter(Boolean)

  return {
    name: text(child(el, 'Name')),
    siren,
    siret,
    vatId: text(vatId ?? null),
    address: addressParts.length ? addressParts.join(', ') : null,
    country: text(child(addr, 'CountryID')),
  }
}

function parseLine(el: Element): InvoiceLine {
  const settlement = child(el, 'SpecifiedLineTradeSettlement')
  const qty = path(el, 'SpecifiedLineTradeDelivery', 'BilledQuantity')
  return {
    id: text(path(el, 'AssociatedDocumentLineDocument', 'LineID')),
    name: text(path(el, 'SpecifiedTradeProduct', 'Name')),
    quantity: num(qty),
    unitCode: qty?.getAttribute('unitCode') ?? null,
    unitPrice: num(path(el, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount')),
    vatRate: num(path(settlement, 'ApplicableTradeTax', 'RateApplicablePercent')),
    total: num(path(settlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount')),
  }
}

/**
 * Lit le XML CII en structure exploitable. Lève une erreur si le XML est
 * malformé ou si la racine n'est pas CrossIndustryInvoice.
 */
export function parseCii(xml: string): InvoiceData {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML malformé')
  const root = doc.documentElement
  if (root.localName !== 'CrossIndustryInvoice') {
    throw new Error(`Racine inattendue : ${root.localName} (CrossIndustryInvoice attendu)`)
  }

  const ctx = child(root, 'ExchangedDocumentContext')
  const header = child(root, 'ExchangedDocument')
  const tx = child(root, 'SupplyChainTradeTransaction')
  const agreement = child(tx, 'ApplicableHeaderTradeAgreement')
  const settlement = child(tx, 'ApplicableHeaderTradeSettlement')
  const summation = child(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation')
  const terms = child(settlement, 'SpecifiedTradePaymentTerms')

  const profileUrn = text(path(ctx, 'GuidelineSpecifiedDocumentContextParameter', 'ID'))
  const profileLabel = profileUrn
    ? (PROFILES.find((p) => p.urn.toLowerCase() === profileUrn.toLowerCase())?.label ?? null)
    : null

  return {
    profileUrn,
    profileLabel,
    number: text(child(header, 'ID')),
    typeCode: text(child(header, 'TypeCode')),
    issueDate: text(path(header, 'IssueDateTime', 'DateTimeString')),
    currency: text(child(settlement, 'InvoiceCurrencyCode')),
    buyerReference: text(child(agreement, 'BuyerReference')),
    orderReference: text(path(agreement, 'BuyerOrderReferencedDocument', 'IssuerAssignedID')),
    seller: parseParty(child(agreement, 'SellerTradeParty')),
    buyer: parseParty(child(agreement, 'BuyerTradeParty')),
    vatBreakdown: childs(settlement, 'ApplicableTradeTax').map((t) => ({
      rate: num(child(t, 'RateApplicablePercent')),
      categoryCode: text(child(t, 'CategoryCode')),
      basis: num(child(t, 'BasisAmount')),
      amount: num(child(t, 'CalculatedAmount')),
    })),
    lines: childs(tx, 'IncludedSupplyChainTradeLineItem').map(parseLine),
    paymentTerms: text(child(terms, 'Description')),
    dueDate: text(path(terms, 'DueDateDateTime', 'DateTimeString')),
    iban: text(
      path(
        childs(settlement, 'SpecifiedTradeSettlementPaymentMeans')[0] ?? null,
        'PayeePartyCreditorFinancialAccount',
        'IBANID'
      )
    ),
    notes: childs(header, 'IncludedNote')
      .map((n) => text(child(n, 'Content')))
      .filter((s): s is string => s !== null),
    totals: {
      lineTotal: num(child(summation, 'LineTotalAmount')),
      taxBasis: num(child(summation, 'TaxBasisTotalAmount')),
      tax: num(child(summation, 'TaxTotalAmount')),
      grand: num(child(summation, 'GrandTotalAmount')),
      prepaid: num(child(summation, 'TotalPrepaidAmount')),
      due: num(child(summation, 'DuePayableAmount')),
    },
  }
}

/** Date CII format 102 (AAAAMMJJ) → affichage français, sinon valeur brute. */
export function formatDate102(raw: string | null): string | null {
  if (!raw) return null
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (!m) return raw
  return `${m[3]}/${m[2]}/${m[1]}`
}
