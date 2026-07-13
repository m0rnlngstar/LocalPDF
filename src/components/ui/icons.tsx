/** Icônes SVG inline (style feather), stroke = currentColor. */

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

export const IconBold = () => (
  <svg {...base}><path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z" /></svg>
)
export const IconItalic = () => (
  <svg {...base}><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></svg>
)
export const IconAlignLeft = () => (
  <svg {...base}><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></svg>
)
export const IconAlignCenter = () => (
  <svg {...base}><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></svg>
)
export const IconAlignRight = () => (
  <svg {...base}><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
)
export const IconType = () => (
  <svg {...base}><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></svg>
)
export const IconImage = () => (
  <svg {...base}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
)
export const IconSquare = () => (
  <svg {...base}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
)
export const IconCircleShape = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /></svg>
)
export const IconLine = () => (
  <svg {...base}><line x1="5" y1="19" x2="19" y2="5" /></svg>
)
export const IconArrow = () => (
  <svg {...base}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>
)
export const IconDroplet = () => (
  <svg {...base}><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>
)
export const IconWatermark = () => (
  <svg {...base}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
)
export const IconTrash = () => (
  <svg {...base}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
)
export const IconChevronUp = () => (
  <svg {...base}><polyline points="18 15 12 9 6 15" /></svg>
)
export const IconChevronDown = () => (
  <svg {...base}><polyline points="6 9 12 15 18 9" /></svg>
)
export const IconChevronsUp = () => (
  <svg {...base}><polyline points="17 11 12 6 7 11" /><polyline points="17 18 12 13 7 18" /></svg>
)
export const IconChevronsDown = () => (
  <svg {...base}><polyline points="7 13 12 18 17 13" /><polyline points="7 6 12 11 17 6" /></svg>
)
export const IconPlus = () => (
  <svg {...base}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
export const IconDownload = () => (
  <svg {...base}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
)
export const IconFilePlus = () => (
  <svg {...base}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
)
export const IconCopy = () => (
  <svg {...base}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
)
export const IconX = () => (
  <svg {...base}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
)
export const IconPointer = () => (
  <svg {...base}><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" /></svg>
)
export const IconHighlighter = () => (
  <svg {...base}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
)
export const IconSignature = () => (
  <svg {...base}><path d="M12 19l7-7 3 3-7 7-3-3z" /><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" /><circle cx="11" cy="11" r="2" /></svg>
)
export const IconNote = () => (
  <svg {...base}><path d="M21 3H3v18h12l6-6V3z" /><polyline points="15 21 15 15 21 15" /></svg>
)
export const IconRotate = () => (
  <svg {...base}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
)
export const IconUpload = () => (
  <svg {...base}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
)
export const IconStamp = () => (
  <svg {...base}><path d="M12 3a3 3 0 0 0-3 3c0 1.6.9 2.6 1.5 3.6.4.7.5 1.4.5 1.4h2s.1-.7.5-1.4c.6-1 1.5-2 1.5-3.6a3 3 0 0 0-3-3z" /><path d="M6 15h12v3H6z" /><line x1="5" y1="21" x2="19" y2="21" /></svg>
)
export const IconEdit = () => (
  <svg {...base}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
)
export const IconGrid = () => (
  <svg {...base}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
)
export const IconScissors = () => (
  <svg {...base}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
)
export const IconPlay = () => (
  <svg {...base}><polygon points="5 3 19 12 5 21 5 3" /></svg>
)
export const IconChevronLeft = () => (
  <svg {...base}><polyline points="15 18 9 12 15 6" /></svg>
)
export const IconChevronRight = () => (
  <svg {...base}><polyline points="9 18 15 12 9 6" /></svg>
)
