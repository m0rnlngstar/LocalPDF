import { FileDropzone } from '../../components/ui/FileDropzone'
import { ModuleIcon } from '../../components/ui/ModuleIcon'
import { MODULES, useAppStore } from '../../store/appStore'
import { ACCEPT } from '../importFiles'
import { addFiles, useDialogs } from '../actions'
import { IconFileText } from './icons'

const FEATURES = [
  'Lire, surligner, commenter',
  'Modifier et ajouter du texte',
  'Réorganiser, pivoter, supprimer des pages',
  'Fusionner PDF, images, HEIC, Word',
  'OCR et recherche',
  'Signer, tamponner, caviarder',
  'Découper et compresser à l’export',
]

/** Écran d'accueil quand aucun document n'est ouvert. */
export function StartScreen() {
  const openDialog = useDialogs((s) => s.open)
  const openTool = useAppStore((s) => s.openTool)

  return (
    <div className="studio-start">
      <div className="studio-start-inner">
        <div className="studio-start-hero">
          <h1>Votre éditeur PDF, 100 % local</h1>
          <p>Ouvrez un ou plusieurs fichiers : tout se passe dans votre navigateur, rien n’est envoyé sur un serveur.</p>
          <ul className="studio-start-features">
            {FEATURES.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </div>

        <FileDropzone
          accept={ACCEPT}
          multiple
          onFiles={(files) => void addFiles(files, 'replace')}
          title="Ouvrir des fichiers"
          description="PDF, images (JPG, PNG, HEIC…), Word (.docx), texte ou Markdown — plusieurs fichiers sont assemblés dans l’ordre."
          actionLabel="Choisir des fichiers"
          className="studio-start-drop"
        />

        <div className="studio-start-actions">
          <button className="studio-start-card" onClick={() => openDialog('new')}>
            <span className="nav-icon tone-violet"><IconFileText /></span>
            <span>
              <strong>Document vierge</strong>
              <small>Créez un PDF de zéro (A4, A5, Letter).</small>
            </span>
          </button>
          {MODULES.map((m) => (
            <button key={m.id} className="studio-start-card" onClick={() => openTool(m.id)}>
              <span className={`nav-icon tone-${m.tone}`}><ModuleIcon module={m.id} /></span>
              <span>
                <strong>{m.label}</strong>
                <small>{m.desc}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
