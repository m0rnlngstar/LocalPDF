import { InfoDialog } from '../../components/ui/InfoDialog'

/** Bouton « i » de la fusion intelligente : explique le pipeline et les réglages avancés. */
export function SmartMergeHelp() {
  return (
    <InfoDialog title="🧠 Fusion intelligente — comment ça marche">
      <p>
        Ce module réassemble un <strong>document scindé en plusieurs fichiers</strong> (ex. des
        pages scannées une par une, mal nommées ou dans le désordre) sans avoir à les trier à la
        main. Déposez les fichiers, cliquez sur <strong>Analyser l'ordre</strong>, ajustez si
        besoin en glissant les cartes, puis <strong>Fusionner</strong>.
      </p>

      <h4 className="font-semibold mt-1">Ce que fait l'analyse</h4>
      <p>
        La première et la dernière page de chaque fichier sont rendues et <strong>lues par OCR</strong>{' '}
        (français + anglais) si nécessaire, puis une empreinte visuelle (aHash 8×8) est calculée
        pour comparer les pages entre elles. Tout se passe dans votre navigateur.
      </p>

      <h4 className="font-semibold mt-1">Trois signaux, par ordre de priorité</h4>
      <div className="overflow-x-auto">
        <table className="table table-sm">
          <thead>
            <tr><th>Signal</th><th>Principe</th><th>Défaut</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="whitespace-nowrap font-medium">Numéros de page</td>
              <td>
                Si le texte OCR contient un numéro cohérent (« Page 2/5 », « (3/5)… ») pour
                plusieurs fichiers, ils sont triés directement par ce numéro. Signal le plus fiable
                quand il est présent.
              </td>
              <td>Activé</td>
            </tr>
            <tr>
              <td className="whitespace-nowrap font-medium">Chaînage visuel</td>
              <td>
                À défaut de numéros exploitables, chaque fichier est enchaîné à celui dont la
                première page ressemble le plus à sa dernière page (plus proche voisin). Utile
                pour des scans partageant une mise en page commune.
              </td>
              <td>Activé</td>
            </tr>
            <tr>
              <td className="whitespace-nowrap font-medium">Ordre alphabétique</td>
              <td>Repli final si aucun autre signal n'est exploitable (tri numérique du nom de fichier).</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-base-content/60">
        Les réglages sont mémorisés d'une session à l'autre. L'ordre proposé reste modifiable :
        glissez les cartes pour l'ajuster avant d'exporter.
      </p>

      <h4 className="font-semibold mt-1">Vérification par IA locale (réglages avancés)</h4>
      <p>
        En option, chaque jointure proposée est relue par un <strong>LLM local</strong> (Gemma, via
        WebGPU) qui compare la fin d'un fichier et le début du suivant. Il ne modifie jamais
        l'ordre : il ajoute juste un badge « confirmé » ou « rupture possible » sur chaque
        jointure, à vérifier à l'œil. Le modèle est téléchargé au premier usage puis mis en cache —
        vos documents, eux, ne quittent jamais la machine.
      </p>
    </InfoDialog>
  )
}
