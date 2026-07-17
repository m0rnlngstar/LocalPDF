import type { SVGProps } from 'react'
import type { ModuleId } from '../../store/appStore'

type IconProps = SVGProps<SVGSVGElement> & { module: ModuleId }

const paths: Record<ModuleId, React.ReactNode> = {
  home: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  scanner: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M8.5 8.5h7l2 2v6h-11v-6Z" />
      <circle cx="12" cy="12.5" r="2.2" />
    </>
  ),
  create: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 12v6M9 15h6" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </>
  ),
  merge: (
    <>
      <path d="M8 6h5a5 5 0 0 1 5 5v8" />
      <path d="m15 16 3 3 3-3" />
      <path d="M8 18h3" />
      <path d="M3 6h1M3 12h8" />
    </>
  ),
  split: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m8.5 7.5 3.5 3.3M8.5 16.5 21 4M14 14l7 6" />
    </>
  ),
  'smart-split': (
    <>
      <path d="M9.5 4.5A3.5 3.5 0 0 0 6 8v.5a3.5 3.5 0 0 0 0 7V16a3.5 3.5 0 0 0 3.5 3.5" />
      <path d="M14.5 4.5A3.5 3.5 0 0 1 18 8v.5a3.5 3.5 0 0 1 0 7V16a3.5 3.5 0 0 1-3.5 3.5M12 3v18M8.5 9.5H12M12 14.5h3.5" />
      <path d="m20 2 .45 1.05L21.5 3.5l-1.05.45L20 5l-.45-1.05-1.05-.45 1.05-.45Z" />
    </>
  ),
  ocr: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M7 9h10M7 12h7M7 15h9" />
    </>
  ),
  facturx: (
    <>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 7h6M9 11h2" />
      <path d="m12.5 15 1.5 1.5 3-3" />
    </>
  ),
  docchat: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="M8 9h8M8 13h5" />
      <path d="m18.5 2 .4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4Z" />
    </>
  ),
}

export function ModuleIcon({ module, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[module]}
    </svg>
  )
}

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M9 5.5h9l6 6V25a2.5 2.5 0 0 1-2.5 2.5H9A2.5 2.5 0 0 1 6.5 25V8A2.5 2.5 0 0 1 9 5.5Z" fill="currentColor" opacity=".18" />
        <path d="M18 5.5v6h6M10.5 17h9M10.5 21h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m23.5 2 .7 1.8L26 4.5l-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" fill="currentColor" />
      </svg>
    </span>
  )
}
