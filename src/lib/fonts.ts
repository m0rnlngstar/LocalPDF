import { StandardFonts } from 'pdf-lib'
import latoRegular from '../assets/fonts/Lato-Regular.ttf'
import latoBold from '../assets/fonts/Lato-Bold.ttf'
import latoItalic from '../assets/fonts/Lato-Italic.ttf'
import latoBoldItalic from '../assets/fonts/Lato-BoldItalic.ttf'
import poppinsRegular from '../assets/fonts/Poppins-Regular.ttf'
import poppinsBold from '../assets/fonts/Poppins-Bold.ttf'
import poppinsItalic from '../assets/fonts/Poppins-Italic.ttf'
import poppinsBoldItalic from '../assets/fonts/Poppins-BoldItalic.ttf'
import pacificoRegular from '../assets/fonts/Pacifico-Regular.ttf'

/**
 * Registre des polices disponibles.
 * - Les 3 familles "standard PDF" (Helvetica, Times, Courier) sont natives dans
 *   tout lecteur : rien à embarquer.
 * - Les autres sont des TTF locales (aucun CDN), embarquées et SOUS-ENSEMBLÉES
 *   (subset) dans le PDF à l'export via fontkit — seuls les glyphes utilisés
 *   sont inclus, le PDF reste léger.
 */

export type FontFamily =
  | 'Helvetica' | 'Times' | 'Courier'
  | 'Lato' | 'Poppins' | 'Pacifico'

type Variant = 'regular' | 'bold' | 'italic' | 'boldItalic'

interface FontDef {
  /** Police CSS pour l'aperçu canvas (Konva). */
  css: string
  /** Variantes pdf-lib pour les polices standard. */
  standard?: Record<Variant, StandardFonts>
  /** URLs des fichiers TTF pour les polices embarquées. */
  files?: Partial<Record<Variant, string>>
  hasBold: boolean
  hasItalic: boolean
}

export const FONTS: Record<FontFamily, FontDef> = {
  Helvetica: {
    css: 'Helvetica, Arial, sans-serif',
    standard: {
      regular: StandardFonts.Helvetica,
      bold: StandardFonts.HelveticaBold,
      italic: StandardFonts.HelveticaOblique,
      boldItalic: StandardFonts.HelveticaBoldOblique,
    },
    hasBold: true,
    hasItalic: true,
  },
  Times: {
    css: '"Times New Roman", Times, serif',
    standard: {
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    },
    hasBold: true,
    hasItalic: true,
  },
  Courier: {
    css: '"Courier New", Courier, monospace',
    standard: {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    },
    hasBold: true,
    hasItalic: true,
  },
  Lato: {
    css: 'Lato, sans-serif',
    files: { regular: latoRegular, bold: latoBold, italic: latoItalic, boldItalic: latoBoldItalic },
    hasBold: true,
    hasItalic: true,
  },
  Poppins: {
    css: 'Poppins, sans-serif',
    files: { regular: poppinsRegular, bold: poppinsBold, italic: poppinsItalic, boldItalic: poppinsBoldItalic },
    hasBold: true,
    hasItalic: true,
  },
  Pacifico: {
    css: 'Pacifico, cursive',
    files: { regular: pacificoRegular },
    hasBold: false,
    hasItalic: false,
  },
}

export const FONT_FAMILIES = Object.keys(FONTS) as FontFamily[]

/** Police CSS utilisée par Konva pour un aperçu fidèle. */
export const CANVAS_FONTS: Record<FontFamily, string> = Object.fromEntries(
  FONT_FAMILIES.map((f) => [f, FONTS[f].css])
) as Record<FontFamily, string>

export function variantOf(bold: boolean, italic: boolean): Variant {
  return bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular'
}

/**
 * Précharge les polices personnalisées pour le rendu canvas : sans cela, le
 * canvas dessine avec la police de secours car @font-face charge à la demande.
 * Résout quand tout est prêt (ou en erreur, sans bloquer).
 */
export async function preloadCanvasFonts(): Promise<void> {
  const loads: Promise<unknown>[] = []
  for (const family of FONT_FAMILIES) {
    const def = FONTS[family]
    if (!def.files) continue
    const cssName = def.css.split(',')[0].replace(/"/g, '')
    loads.push(document.fonts.load(`16px "${cssName}"`).catch(() => {}))
    if (def.hasBold) loads.push(document.fonts.load(`bold 16px "${cssName}"`).catch(() => {}))
    if (def.hasItalic) loads.push(document.fonts.load(`italic 16px "${cssName}"`).catch(() => {}))
    if (def.hasBold && def.hasItalic)
      loads.push(document.fonts.load(`italic bold 16px "${cssName}"`).catch(() => {}))
  }
  await Promise.all(loads)
}

/** Convertit une couleur hex (#rrggbb) en composantes [0..1] pour pdf-lib. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}
