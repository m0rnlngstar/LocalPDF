/** Icônes complémentaires de l'éditeur (même style que components/ui/icons). */

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

export const IconHand = () => (
  <svg {...base}><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" /></svg>
)
export const IconUndo = () => (
  <svg {...base}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
)
export const IconRedo = () => (
  <svg {...base}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
)
export const IconZoomIn = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M11 8v6M8 11h6" /></svg>
)
export const IconZoomOut = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3M8 11h6" /></svg>
)
export const IconSearch = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
)
export const IconComments = () => (
  <svg {...base}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
)
export const IconScanText = () => (
  <svg {...base}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8h8M7 12h10M7 16h6" /></svg>
)
export const IconRedact = () => (
  <svg {...base}><rect x="3" y="8" width="18" height="8" rx="1" fill="currentColor" /><path d="M3 4h18M3 20h12" /></svg>
)
export const IconSidebar = () => (
  <svg {...base}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
)
export const IconSliders = () => (
  <svg {...base}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
)
export const IconFileText = () => (
  <svg {...base}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></svg>
)
export const IconFolderOpen = () => (
  <svg {...base}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6A2 2 0 0 1 18.5 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2" /></svg>
)
export const IconRotateLeft = () => (
  <svg {...base}><path d="M3 2v6h6" /><path d="M3.5 13a9 9 0 1 0 2.1-9.4L3 8" /></svg>
)
export const IconBook = () => (
  <svg {...base}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
)
export const IconWand = () => (
  <svg {...base}><path d="m15 4 5 5M3 21l11-11M14 2v2M20 8h2M17 3l1-1M21 7l1-1" /></svg>
)
export const IconTextCursor = () => (
  <svg {...base}><path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4v-1M7 2h1a4 4 0 0 1 4 4v1" /></svg>
)
export const IconMore = () => (
  <svg {...base}><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
)
export const IconArrowLeft = () => (
  <svg {...base}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
)
export const IconMaximize = () => (
  <svg {...base}><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
)
export const IconCallout = () => (
  <svg {...base}><rect x="9" y="3" width="12" height="9" rx="1.5" /><path d="M12 7h6M9 10 3.5 19.5M3.5 19.5l.4-3.6M3.5 19.5l3.4-1.2" /></svg>
)
export const IconTextSelect = () => (
  <svg {...base}><path d="M5 4h4M7 4v16M5 20h4" /><rect x="12" y="7" width="9" height="4" rx="1" /><path d="M12 15h9M12 19h6" /></svg>
)
export const IconReceipt = () => (
  <svg {...base}><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
)
