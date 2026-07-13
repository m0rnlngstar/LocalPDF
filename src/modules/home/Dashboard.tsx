import { MODULES, useAppStore } from '../../store/appStore'

/**
 * Page d'accueil : tableau de bord des outils, une carte cliquable par module.
 * Le menu latéral reste la navigation principale ; les cartes en sont le
 * miroir, avec une description de ce que fait chaque outil.
 */
export default function Dashboard() {
  const setActiveModule = useAppStore((s) => s.setActiveModule)
  const tools = MODULES.filter((m) => m.id !== 'home')

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6 mt-2 sm:mt-6">
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          Que voulez-vous faire ?
        </h2>
        <p className="text-sm text-base-content/60 mt-2 max-w-xl mx-auto">
          Tous les traitements — y compris l'IA — tournent dans votre navigateur :
          vos fichiers ne quittent jamais votre machine.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((m) => (
          <button
            key={m.id}
            className="card bg-base-100 border border-base-300/50 shadow-sm text-left
              transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-primary/40
              focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
            onClick={() => setActiveModule(m.id)}
          >
            <div className="card-body p-5 gap-2">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-primary/10 text-2xl" aria-hidden>
                  {m.icon}
                </span>
                <h3 className="card-title text-base">{m.label}</h3>
              </div>
              <p className="text-sm text-base-content/60">{m.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
