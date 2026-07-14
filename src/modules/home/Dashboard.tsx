import { useMemo, useState } from 'react'
import { MODULES, useAppStore, type ModuleId } from '../../store/appStore'
import { BrandMark, ModuleIcon } from '../../components/ui/ModuleIcon'

/**
 * Page d'accueil : tableau de bord des outils, une carte cliquable par module.
 * Le menu latéral reste la navigation principale ; les cartes en sont le
 * miroir, avec une description de ce que fait chaque outil.
 */
export default function Dashboard() {
  const setActiveModule = useAppStore((s) => s.setActiveModule)
  const [query, setQuery] = useState('')
  const tools = MODULES.filter((m) => m.id !== 'home')
  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr')
    if (!normalized) return tools
    return tools.filter((tool) =>
      `${tool.label} ${tool.desc} ${tool.category}`.toLocaleLowerCase('fr').includes(normalized)
    )
  }, [query, tools])

  function openModule(id: ModuleId) {
    setActiveModule(id)
  }

  return (
    <div className="dashboard-shell">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span className="status-pulse" />
            Prêt à travailler · aucun envoi requis
          </div>
          <h2 id="dashboard-title">
            Tous vos outils PDF.<br />
            <span>Directement chez vous.</span>
          </h2>
          <p>
            Modifiez, organisez et analysez vos documents sans compte et sans cloud.
            Même l’OCR et l’IA s’exécutent dans votre navigateur.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary hero-primary-action" onClick={() => openModule('edit')}>
              <ModuleIcon module="edit" />
              Modifier un PDF
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>
            </button>
            <button className="btn hero-secondary-action" onClick={() => openModule('merge')}>
              <ModuleIcon module="merge" />
              Fusionner des fichiers
            </button>
          </div>
        </div>

        <div className="hero-privacy-card">
          <div className="privacy-visual">
            <BrandMark />
            <span className="privacy-orbit orbit-one" />
            <span className="privacy-orbit orbit-two" />
          </div>
          <div className="privacy-copy">
            <span className="privacy-kicker">Confidentialité intégrée</span>
            <h3>Votre document ne voyage jamais.</h3>
            <ul>
              <li><span>✓</span> Traitement 100 % local</li>
              <li><span>✓</span> Aucun compte nécessaire</li>
              <li><span>✓</span> Données sous votre contrôle</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="tools-section" aria-labelledby="tools-title">
        <div className="tools-heading">
          <div>
            <span className="section-kicker">Boîte à outils</span>
            <h2 id="tools-title">Que voulez-vous faire ?</h2>
          </div>
          <label className="tool-search">
            <span className="sr-only">Rechercher un outil</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              placeholder="Rechercher un outil…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche">×</button>
            )}
          </label>
        </div>

        <div className="tool-grid">
          {filteredTools.map((m) => (
          <button
            key={m.id}
            className={`tool-card tone-${m.tone}`}
            onClick={() => setActiveModule(m.id)}
          >
            <div className="tool-card-topline">
              <span className="tool-icon"><ModuleIcon module={m.id} /></span>
              <span className="tool-category">{m.category}</span>
              <span className="tool-arrow" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
              </span>
            </div>
            <div>
              <div className="tool-title-line">
                <h3>{m.label}</h3>
                {m.badge && <span className="tool-badge">{m.badge}</span>}
              </div>
              <p>{m.desc}</p>
            </div>
          </button>
          ))}
        </div>

        {filteredTools.length === 0 && (
          <div className="tools-empty">
            <ModuleIcon module="home" />
            <h3>Aucun outil trouvé</h3>
            <p>Essayez par exemple « OCR », « fusionner » ou « facture ».</p>
            <button className="btn btn-sm" onClick={() => setQuery('')}>Afficher tous les outils</button>
          </div>
        )}
      </section>
    </div>
  )
}
