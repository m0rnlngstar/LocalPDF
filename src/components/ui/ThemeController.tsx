import { useAppStore } from '../../store/appStore'

const THEMES = ['light', 'dark', 'corporate', 'synthwave', 'dracula']

export function ThemeController() {
  const { theme, setTheme } = useAppStore()
  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn btn-ghost btn-sm gap-1">
        🎨 <span className="hidden sm:inline capitalize">{theme}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content menu bg-base-200 rounded-box z-50 w-40 p-2 shadow-2xl"
      >
        {THEMES.map((t) => (
          <li key={t}>
            <input
              type="radio"
              name="theme-dropdown"
              className="theme-controller btn btn-sm btn-block btn-ghost justify-start capitalize"
              aria-label={t}
              value={t}
              checked={theme === t}
              onChange={() => setTheme(t)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
