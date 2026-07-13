import { useMemo, useState } from 'react'
import { FileDropzone } from '../../components/ui/FileDropzone'
import { InfoDialog } from '../../components/ui/InfoDialog'
import { toast } from '../../components/ui/Toast'
import {
  IconAlertTriangle, IconCheck, IconDownload, IconX,
} from '../../components/ui/icons'
import {
  extractFacturX, formatDate102, parseCii, TYPE_CODES,
  type ExtractionResult, type InvoiceData, type TradeParty,
} from './parse'
import { overallStatus, runChecks, type CheckResult, type CheckStatus } from './checks'

/**
 * Vérificateur / lecteur Factur-X : ouvre une facture électronique (PDF avec
 * XML CII embarqué), contrôle sa conformité de premier niveau et affiche les
 * données portées par le XML.
 */

function FacturXHelp() {
  return (
    <InfoDialog title="🧾 Vérificateur Factur-X — comment ça marche">
      <p>
        Une <strong>facture électronique Factur-X</strong> (norme AFNOR XP Z12-012 / EN 16931,
        format retenu pour la réforme française de la facturation électronique) est un PDF
        hybride : lisible à l'œil, mais contenant aussi un <strong>fichier XML embarqué</strong>{' '}
        (<code>factur-x.xml</code>) qui porte les données structurées — c'est ce XML qui fait
        foi pour les logiciels comptables et les plateformes agréées.
      </p>
      <h4 className="font-semibold mt-1">Ce que fait ce module</h4>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>Extrait le XML embarqué dans le PDF (rien ne quitte votre navigateur) ;</li>
        <li>
          Identifie le <strong>profil</strong> (MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED) —
          plus le profil est riche, plus le XML contient de détails (lignes, TVA par taux…) ;
        </li>
        <li>
          Contrôle les <strong>champs obligatoires</strong> (n° de facture, date, vendeur,
          acheteur, devise, totaux), la <strong>validité des identifiants français</strong>{' '}
          (clé du SIREN, clé du n° de TVA intracommunautaire) et la{' '}
          <strong>cohérence des montants</strong> (TTC = HT + TVA, somme des lignes, TVA par
          taux) ;
        </li>
        <li>Affiche les informations que la facture remonte : parties, échéance, lignes, TVA…</li>
      </ul>
      <h4 className="font-semibold mt-1">Limites</h4>
      <p>
        C'est un contrôle de premier niveau, utile pour repérer une facture non conforme ou
        mal générée avant de l'envoyer en compta. Il ne remplace pas la validation Schematron
        complète de la norme ni les contrôles d'une plateforme de dématérialisation agréée.
        Un PDF sans XML embarqué (simple scan ou export bureautique) n'est <em>pas</em> une
        facture électronique au sens de la réforme.
      </p>
    </InfoDialog>
  )
}

const STATUS_BADGE: Record<CheckStatus, { cls: string; icon: React.ReactNode }> = {
  ok: { cls: 'badge-success', icon: <IconCheck /> },
  warn: { cls: 'badge-warning', icon: <IconAlertTriangle /> },
  fail: { cls: 'badge-error', icon: <IconX /> },
}

function CheckRow({ check }: { check: CheckResult }) {
  const s = STATUS_BADGE[check.status]
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className={`badge badge-soft ${s.cls} badge-sm gap-1 shrink-0 mt-0.5`}>{s.icon}</span>
      <div className="min-w-0">
        <span className="text-sm">{check.label}</span>
        {check.detail && (
          <p className="text-xs text-base-content/60 break-words">{check.detail}</p>
        )}
      </div>
    </li>
  )
}

function PartyCard({ title, party }: { title: string; party: TradeParty }) {
  const rows: [string, string | null][] = [
    ['SIREN', party.siren],
    ['SIRET', party.siret],
    ['TVA intracom.', party.vatId],
    ['Adresse', party.address],
    ['Pays', party.country],
  ]
  return (
    <div className="card bg-base-100 border border-base-300/50 shadow-sm flex-1 min-w-60">
      <div className="card-body p-4 gap-1">
        <h3 className="text-xs uppercase tracking-wide text-base-content/50">{title}</h3>
        <p className="font-semibold">{party.name ?? <span className="text-error">non renseigné</span>}</p>
        {rows.map(([label, value]) =>
          value ? (
            <p key={label} className="text-sm">
              <span className="text-base-content/50">{label} : </span>{value}
            </p>
          ) : null
        )}
      </div>
    </div>
  )
}

export default function FacturXModule() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [data, setData] = useState<InvoiceData | null>(null)
  const [loading, setLoading] = useState(false)

  const checks = useMemo(
    () => (extraction ? runChecks(extraction, data) : []),
    [extraction, data]
  )
  const verdict = useMemo(() => overallStatus(checks), [checks])

  const money = useMemo(() => {
    const currency = data?.currency ?? 'EUR'
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency })
    } catch {
      return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 })
    }
  }, [data?.currency])
  const fmt = (v: number | null) => (v === null ? '—' : money.format(v))

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setLoading(true)
    try {
      const bytes = await file.arrayBuffer()
      const ext = await extractFacturX(bytes)
      let parsed: InvoiceData | null = null
      if (ext.xml) {
        try {
          parsed = parseCii(ext.xml)
        } catch (err) {
          console.error(err)
        }
      }
      setFileName(file.name)
      setExtraction(ext)
      setData(parsed)
    } catch (err) {
      console.error(err)
      toast.error('Impossible de lire ce PDF')
    } finally {
      setLoading(false)
    }
  }

  function exportJson() {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(data.number ?? fileName ?? 'facture').replace(/\.pdf$/i, '')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success('Données exportées en JSON')
  }

  if (!extraction) {
    return (
      <div className="max-w-xl mx-auto mt-6 sm:mt-16">
        <FileDropzone
          accept="application/pdf"
          onFiles={(files) => void handleFiles(files)}
          className="bg-base-100 shadow-xl py-16"
          icon={loading ? <span className="loading loading-spinner" /> : undefined}
          title="Déposez une facture électronique (Factur-X)"
          description="Vérification de conformité (profil, champs obligatoires, SIREN/TVA, montants) et lecture des données embarquées dans le XML"
          footer={
            <span className="text-xs text-base-content/50 flex items-center gap-1">
              Comment ça marche ? <FacturXHelp />
            </span>
          }
        />
      </div>
    )
  }

  const typeLabel = data?.typeCode ? (TYPE_CODES[data.typeCode] ?? `code ${data.typeCode}`) : null

  return (
    <div className="flex flex-col gap-3 max-w-4xl mx-auto">
      {/* Barre d'actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{fileName}</span>
        <FacturXHelp />
        <div className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-ghost rounded-full gap-1"
            onClick={() => {
              setExtraction(null)
              setData(null)
              setFileName(null)
            }}
          >
            <IconX /> Fermer
          </button>
          <button
            className="btn btn-sm btn-primary rounded-full shadow-md gap-1.5"
            onClick={exportJson}
            disabled={!data}
          >
            <IconDownload /> Exporter JSON
          </button>
        </div>
      </div>

      {/* Verdict */}
      <div
        className={`alert ${
          verdict === 'ok' ? 'alert-success' : verdict === 'warn' ? 'alert-warning' : 'alert-error'
        }`}
      >
        {verdict === 'ok' ? <IconCheck /> : verdict === 'warn' ? <IconAlertTriangle /> : <IconX />}
        <div>
          <span className="font-semibold">
            {verdict === 'ok' && 'Facture conforme (contrôle de premier niveau)'}
            {verdict === 'warn' && 'Facture lisible, avec avertissements'}
            {verdict === 'fail' && 'Facture non conforme'}
          </span>
          {data?.profileLabel && (
            <span className="badge badge-neutral badge-sm ml-2">profil {data.profileLabel}</span>
          )}
        </div>
      </div>

      {/* Contrôles */}
      <div className="collapse collapse-arrow bg-base-100 border border-base-300/50 shadow-sm">
        <input type="checkbox" defaultChecked={verdict !== 'ok'} />
        <div className="collapse-title text-sm font-medium py-2 min-h-0">
          ✅ Détail des contrôles (
          {checks.filter((c) => c.status === 'ok').length}/{checks.length} OK
          {checks.some((c) => c.status === 'fail') &&
            ` — ${checks.filter((c) => c.status === 'fail').length} bloquant${checks.filter((c) => c.status === 'fail').length > 1 ? 's' : ''}`}
          )
        </div>
        <div className="collapse-content">
          <ul className="divide-y divide-base-200">
            {checks.map((c, i) => <CheckRow key={i} check={c} />)}
          </ul>
        </div>
      </div>

      {data && (
        <>
          {/* En-tête de la facture */}
          <div className="card bg-base-100 border border-base-300/50 shadow-sm">
            <div className="card-body p-4 gap-2">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="text-lg font-bold">
                  {typeLabel ?? 'Document'} {data.number && <span className="font-mono">{data.number}</span>}
                </h2>
                {data.issueDate && (
                  <span className="text-sm text-base-content/60">
                    émise le {formatDate102(data.issueDate)}
                  </span>
                )}
                {data.dueDate && (
                  <span className="text-sm text-base-content/60">
                    échéance {formatDate102(data.dueDate)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {data.buyerReference && (
                  <span><span className="text-base-content/50">Réf. acheteur : </span>{data.buyerReference}</span>
                )}
                {data.orderReference && (
                  <span><span className="text-base-content/50">Commande : </span>{data.orderReference}</span>
                )}
                {data.iban && (
                  <span><span className="text-base-content/50">IBAN : </span><span className="font-mono">{data.iban}</span></span>
                )}
                {data.paymentTerms && (
                  <span><span className="text-base-content/50">Conditions : </span>{data.paymentTerms}</span>
                )}
              </div>
              {data.notes.length > 0 && (
                <p className="text-xs text-base-content/60 whitespace-pre-wrap">{data.notes.join('\n')}</p>
              )}
            </div>
          </div>

          {/* Parties */}
          <div className="flex flex-wrap gap-3">
            <PartyCard title="Vendeur" party={data.seller} />
            <PartyCard title="Acheteur" party={data.buyer} />
          </div>

          {/* Totaux + TVA */}
          <div className="flex flex-wrap gap-3">
            <div className="card bg-base-100 border border-base-300/50 shadow-sm flex-1 min-w-60">
              <div className="card-body p-4 gap-1">
                <h3 className="text-xs uppercase tracking-wide text-base-content/50">Totaux</h3>
                <table className="table table-sm">
                  <tbody>
                    <tr><td>Total HT</td><td className="text-right font-mono">{fmt(data.totals.taxBasis)}</td></tr>
                    <tr><td>TVA</td><td className="text-right font-mono">{fmt(data.totals.tax)}</td></tr>
                    <tr className="font-semibold"><td>Total TTC</td><td className="text-right font-mono">{fmt(data.totals.grand)}</td></tr>
                    {data.totals.prepaid !== null && data.totals.prepaid !== 0 && (
                      <tr><td>Déjà payé</td><td className="text-right font-mono">{fmt(data.totals.prepaid)}</td></tr>
                    )}
                    <tr className="font-bold text-primary"><td>Net à payer</td><td className="text-right font-mono">{fmt(data.totals.due)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            {data.vatBreakdown.length > 0 && (
              <div className="card bg-base-100 border border-base-300/50 shadow-sm flex-1 min-w-60">
                <div className="card-body p-4 gap-1">
                  <h3 className="text-xs uppercase tracking-wide text-base-content/50">TVA par taux</h3>
                  <table className="table table-sm">
                    <thead>
                      <tr><th>Taux</th><th className="text-right">Base HT</th><th className="text-right">Montant</th></tr>
                    </thead>
                    <tbody>
                      {data.vatBreakdown.map((v, i) => (
                        <tr key={i}>
                          <td>{v.rate !== null ? `${v.rate} %` : '—'}{v.categoryCode && v.categoryCode !== 'S' ? ` (${v.categoryCode})` : ''}</td>
                          <td className="text-right font-mono">{fmt(v.basis)}</td>
                          <td className="text-right font-mono">{fmt(v.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Lignes de facture */}
          {data.lines.length > 0 && (
            <div className="collapse collapse-arrow bg-base-100 border border-base-300/50 shadow-sm">
              <input type="checkbox" defaultChecked={data.lines.length <= 8} />
              <div className="collapse-title text-sm font-medium py-2 min-h-0">
                📋 Lignes de facture ({data.lines.length})
              </div>
              <div className="collapse-content overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>#</th><th>Désignation</th>
                      <th className="text-right">Qté</th>
                      <th className="text-right">PU HT</th>
                      <th className="text-right">TVA</th>
                      <th className="text-right">Total HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.id ?? i + 1}</td>
                        <td>{l.name ?? '—'}</td>
                        <td className="text-right font-mono">{l.quantity ?? '—'}</td>
                        <td className="text-right font-mono">{fmt(l.unitPrice)}</td>
                        <td className="text-right font-mono">{l.vatRate !== null ? `${l.vatRate} %` : '—'}</td>
                        <td className="text-right font-mono">{fmt(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* XML brut */}
      {extraction.xml && (
        <div className="collapse collapse-arrow bg-base-100 border border-base-300/50 shadow-sm">
          <input type="checkbox" />
          <div className="collapse-title text-sm font-medium py-2 min-h-0">
            🧬 XML source ({extraction.xmlFilename})
          </div>
          <div className="collapse-content">
            <pre className="text-xs bg-base-200 rounded-box p-3 overflow-x-auto max-h-96">
              {extraction.xml}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
