import { useAppStore } from '../../store/appStore'

const THEMES = [
  { id: 'light', label: 'Clair', colors: ['#ffffff', '#6d5dfc'] },
  { id: 'dark', label: 'Sombre', colors: ['#171821', '#9b8cff'] },
  { id: 'corporate', label: 'Bureau', colors: ['#ffffff', '#2563eb'] },
  { id: 'synthwave', label: 'Synthwave', colors: ['#2d1b69', '#e779c1'] },
  { id: 'dracula', label: 'Dracula', colors: ['#282a36', '#bd93f9'] },
]

export function ThemeController() {
  const { theme, setTheme } = useAppStore()
  const activeTheme = THEMES.find((item) => item.id === theme) ?? THEMES[0]
  return (
    <div className="dropdown dropdown-end">
      <button
        type="button"
        tabIndex={0}
        className="theme-trigger"
        aria-label={`Thème actuel : ${activeTheme.label}. Changer de thème`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a2.5 2.5 0 0 1-2.5-2.5V6c0-1.7-1.3-3-3-3Z" />
          <circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="8.5" cy="15" r="1" />
        </svg>
        <span className="hidden sm:inline">{activeTheme.label}</span>
        <svg className="theme-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <ul
        tabIndex={0}
        className="dropdown-content theme-menu z-50"
      >
        <li className="theme-menu-title">Apparence</li>
        {THEMES.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={theme === item.id ? 'is-selected' : ''}
              onClick={() => {
                setTheme(item.id)
                ;(document.activeElement as HTMLElement | null)?.blur()
              }}
            >
              <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${item.colors[0]} 50%, ${item.colors[1]} 50%)` }} />
              <span>{item.label}</span>
              {theme === item.id && (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
