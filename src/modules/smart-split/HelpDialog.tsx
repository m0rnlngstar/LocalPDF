import { InfoDialog } from '../../components/ui/InfoDialog'

/** Bouton « i » du splitteur : explique le pipeline et les réglages avancés. */
export function SmartSplitHelp() {
  return (
    <InfoDialog title="🧠 Splitteur intelligent — comment ça marche">
      <p>
        Ce module découpe un <strong>PDF « fourre-tout »</strong> (ex. un scan de 40 pages
        contenant 7 factures) en documents individuels. Déposez le PDF, cliquez sur{' '}
        <strong>Analyser</strong>, ajustez les coupures proposées (ciseaux entre les pages),
        puis <strong>Exporter</strong> : un <code>.zip</code> avec un PDF par document.
      </p>

      <h4 className="font-semibold mt-1">Ce que fait l'analyse</h4>
      <p>
        Chaque page est rendue en image puis <strong>lue par OCR</strong> (reconnaissance de
        texte, français + anglais — fonctionne donc aussi sur des scans sans texte
        sélectionnable). L'app mesure aussi le « taux d'encre » de chaque page pour repérer
        les pages blanches, et calcule une empreinte visuelle pour comparer les pages entre
        elles. Tout se passe dans votre navigateur.
      </p>

      <h4 className="font-semibold mt-1">Les trois signaux de coupure</h4>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr><th>Signal</th><th>Principe</th><th>Défaut</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="whitespace-nowrap font-medium">Motifs de texte</td>
              <td>
                Si le texte OCR d'une page contient un motif (regex) comme « Facture n° »,
                un nouveau document commence sur cette page. Adaptez les motifs à vos
                documents : <code>Dossier\s+\d+</code>, <code>Bulletin de paie</code>, un
                en-tête récurrent…
              </td>
              <td>Activé</td>
            </tr>
            <tr>
              <td className="whitespace-nowrap font-medium">Pages blanches</td>
              <td>
                Une page blanche suivie d'une page non blanche → coupure. Montez le seuil
                d'encre si vos scans sont bruités (points, plis) ; les blanches peuvent être
                exclues de l'export (scans recto/verso).
              </td>
              <td>Activé</td>
            </tr>
            <tr>
              <td className="whitespace-nowrap font-medium">Rupture visuelle</td>
              <td>
                Deux pages consécutives très différentes visuellement → coupure suggérée.
                Signal d'appoint, plus bruité : baissez la sensibilité pour plus de
                propositions, à vérifier à l'œil.
              </td>
              <td>Désactivé</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-base-content/60">
        En survolant des ciseaux actifs, une infobulle indique pourquoi la coupure a été
        proposée. Les réglages sont mémorisés d'une session à l'autre.
      </p>

      <h4 className="font-semibold mt-1">Vérification par IA locale (réglages avancés)</h4>
      <p>
        En option, chaque coupure proposée est relue par un <strong>LLM local</strong> (Gemma,
        via WebGPU) qui compare le texte des deux pages et retire les coupures « continuation
        du même document ». Le modèle (~700 Mo) est téléchargé au premier usage puis mis en
        cache — vos documents, eux, ne quittent jamais votre machine. Nécessite un navigateur
        récent avec WebGPU ; les coupures manuelles ne sont jamais modifiées.
      </p>

      <h4 className="font-semibold mt-1">Aucune coupure détectée ?</h4>
      <p>
        Vos documents n'ont probablement ni motif correspondant ni pages blanches : ajoutez
        un motif adapté dans les réglages avancés, activez la rupture visuelle, ou placez
        les coupures à la main — les ciseaux entre les pages fonctionnent toujours.
      </p>
    </InfoDialog>
  )
}
