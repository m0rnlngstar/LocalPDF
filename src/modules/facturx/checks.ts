import {
  TYPE_CODES,
  type ExtractionResult,
  type InvoiceData,
} from './parse'

/**
 * Contrôles de conformité Factur-X. Il s'agit d'une vérification de premier
 * niveau (structure, champs obligatoires, identifiants français, cohérence
 * des montants) — pas d'une validation Schematron complète de la norme.
 *
 * Trois niveaux : `fail` (bloquant : la facture n'est pas exploitable en
 * l'état), `warn` (à corriger mais non bloquant), `ok`.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface CheckResult {
  label: string
  status: CheckStatus
  detail?: string
}

/** Validation Luhn d'un SIREN (9 chiffres). */
export function isValidSiren(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let d = Number(siren[i])
    // positions paires (2e, 4e…) doublées, en partant de la gauche sur 9 chiffres
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** Validation d'un n° TVA intracommunautaire français (clé calculée du SIREN). */
export function isValidFrVat(vat: string): boolean {
  const m = /^FR(\d{2})(\d{9})$/.exec(vat.replace(/\s/g, ''))
  if (!m) return false
  const key = Number(m[1])
  const siren = Number(m[2])
  return key === (12 + 3 * (siren % 97)) % 97
}

const eq = (a: number, b: number, tolerance = 0.011) => Math.abs(a - b) <= tolerance

export function runChecks(extraction: ExtractionResult, data: InvoiceData | null): CheckResult[] {
  const checks: CheckResult[] = []
  const add = (label: string, status: CheckStatus, detail?: string) =>
    checks.push({ label, status, detail })

  // --- Structure du PDF ---
  if (!extraction.xml) {
    add(
      'XML de facture embarqué dans le PDF',
      'fail',
      "Aucune pièce jointe XML trouvée : ce PDF n'est pas une facture électronique Factur-X (facture « image » simple)."
    )
    return checks
  }
  add('XML de facture embarqué dans le PDF', 'ok', `Pièce jointe « ${extraction.xmlFilename} »`)

  if (extraction.xmlFilename?.toLowerCase() !== 'factur-x.xml') {
    add(
      'Nom du fichier XML',
      'warn',
      `« ${extraction.xmlFilename} » : la norme Factur-X attend « factur-x.xml » (nom ZUGFeRD/autre profil accepté par certains outils).`
    )
  } else {
    add('Nom du fichier XML', 'ok', 'factur-x.xml')
  }

  if (extraction.pdfA3 === true) {
    add('Conteneur PDF/A-3 déclaré', 'ok', 'Le XMP déclare pdfaid:part = 3')
  } else if (extraction.pdfA3 === false) {
    add(
      'Conteneur PDF/A-3 déclaré',
      'warn',
      'Les métadonnées XMP ne déclarent pas PDF/A-3, requis par la norme pour l’archivage.'
    )
  } else {
    add('Conteneur PDF/A-3 déclaré', 'warn', 'Métadonnées XMP absentes ou illisibles.')
  }

  if (!data) {
    add('Lecture du XML CII', 'fail', 'XML malformé ou racine CrossIndustryInvoice absente.')
    return checks
  }
  add('Lecture du XML CII', 'ok', 'Racine CrossIndustryInvoice lue')

  // --- Profil ---
  if (!data.profileUrn) {
    add('Profil Factur-X (BT-24)', 'fail', 'GuidelineSpecifiedDocumentContextParameter absent.')
  } else if (!data.profileLabel) {
    add('Profil Factur-X (BT-24)', 'warn', `URN non reconnu : ${data.profileUrn}`)
  } else {
    add('Profil Factur-X (BT-24)', 'ok', data.profileLabel)
  }

  // --- Champs obligatoires (socle commun à tous les profils, dont MINIMUM) ---
  const mandatory: [string, string | null][] = [
    ['Numéro de facture (BT-1)', data.number],
    ["Date d'émission (BT-2)", data.issueDate],
    ['Type de document (BT-3)', data.typeCode],
    ['Devise (BT-5)', data.currency],
    ['Nom du vendeur (BT-27)', data.seller.name],
    ['Nom de l’acheteur (BT-44)', data.buyer.name],
  ]
  for (const [label, value] of mandatory) {
    add(label, value ? 'ok' : 'fail', value ?? 'Champ absent du XML.')
  }

  if (data.issueDate && !/^\d{8}$/.test(data.issueDate)) {
    add("Format de la date d'émission", 'warn', `« ${data.issueDate} » : format 102 (AAAAMMJJ) attendu.`)
  }

  if (data.typeCode) {
    const known = TYPE_CODES[data.typeCode]
    if (!known) add('Code de type de document', 'warn', `Code ${data.typeCode} inhabituel (380 = facture, 381 = avoir…).`)
  }

  // --- Identifiants français ---
  const sellerSiren = data.seller.siren
  if (!sellerSiren) {
    add(
      'SIREN du vendeur (BT-30)',
      'warn',
      'Absent : obligatoire pour une facture française (schemeID 0002 sur SpecifiedLegalOrganization).'
    )
  } else if (!isValidSiren(sellerSiren)) {
    add('SIREN du vendeur (BT-30)', 'fail', `${sellerSiren} : clé de contrôle (Luhn) invalide.`)
  } else {
    add('SIREN du vendeur (BT-30)', 'ok', sellerSiren)
  }

  if (data.seller.vatId) {
    if (data.seller.vatId.toUpperCase().startsWith('FR') && !isValidFrVat(data.seller.vatId)) {
      add('N° TVA intracom. du vendeur (BT-31)', 'fail', `${data.seller.vatId} : clé de contrôle invalide.`)
    } else {
      add('N° TVA intracom. du vendeur (BT-31)', 'ok', data.seller.vatId)
    }
  } else {
    add('N° TVA intracom. du vendeur (BT-31)', 'warn', 'Absent (obligatoire sauf franchise en base).')
  }

  if (data.buyer.siren && !isValidSiren(data.buyer.siren)) {
    add("SIREN de l'acheteur (BT-47)", 'fail', `${data.buyer.siren} : clé de contrôle (Luhn) invalide.`)
  } else {
    add(
      "SIREN de l'acheteur (BT-47)",
      data.buyer.siren ? 'ok' : 'warn',
      data.buyer.siren ?? 'Absent : attendu en B2B France (réforme facturation électronique).'
    )
  }

  // --- Montants ---
  const { taxBasis, tax, grand, prepaid, due, lineTotal } = data.totals
  const totalsPresent = [taxBasis, tax, grand, due].every((v) => v !== null)
  add(
    'Totaux présents (HT, TVA, TTC, net à payer)',
    totalsPresent ? 'ok' : 'fail',
    totalsPresent ? undefined : 'Un ou plusieurs montants de SpecifiedTradeSettlementHeaderMonetarySummation manquent.'
  )

  if (taxBasis !== null && tax !== null && grand !== null) {
    add(
      'Cohérence TTC = HT + TVA',
      eq(taxBasis + tax, grand) ? 'ok' : 'fail',
      `${taxBasis.toFixed(2)} + ${tax.toFixed(2)} = ${(taxBasis + tax).toFixed(2)} / TTC déclaré ${grand.toFixed(2)}`
    )
  }
  if (grand !== null && due !== null) {
    const expected = grand - (prepaid ?? 0)
    add(
      'Cohérence net à payer = TTC − déjà payé',
      eq(expected, due) ? 'ok' : 'warn',
      `${expected.toFixed(2)} attendu / ${due.toFixed(2)} déclaré`
    )
  }
  if (data.lines.length > 0 && lineTotal !== null) {
    const sum = data.lines.reduce((a, l) => a + (l.total ?? 0), 0)
    add(
      'Somme des lignes = total des lignes (BT-106)',
      eq(sum, lineTotal) ? 'ok' : 'warn',
      `${sum.toFixed(2)} / ${lineTotal.toFixed(2)} déclaré`
    )
  }
  for (const v of data.vatBreakdown) {
    if (v.basis === null || v.amount === null || v.rate === null) continue
    const expected = (v.basis * v.rate) / 100
    add(
      `TVA ${v.rate}% : montant = base × taux`,
      eq(expected, v.amount, 0.02) ? 'ok' : 'warn',
      `${expected.toFixed(2)} attendu / ${v.amount.toFixed(2)} déclaré`
    )
  }

  return checks
}

/** Verdict global à partir des contrôles. */
export function overallStatus(checks: CheckResult[]): CheckStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail'
  if (checks.some((c) => c.status === 'warn')) return 'warn'
  return 'ok'
}
