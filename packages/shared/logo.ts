/**
 * Canonical Adits logo — ink-blue corner brackets on parchment, framing the
 * file. Stored as a raster (`public/logo-mark.png`) because the woodblock-print
 * texture doesn't survive vectorization.
 *
 * Consumers:
 *   Web:    <img src={ADITS_LOGO_URL} />
 *   Mobile: bundle `public/logo-mark.png` as a PNG asset (react-native's
 *           SvgXml wrapper below will also work for web SVG renderers via
 *           the external <image> reference, but NOT for react-native-svg).
 */

export const LOGO_INK = '#1B365D'
export const LOGO_ACCENT = '#1B365D'

export const ADITS_LOGO_URL = '/logo-mark.png'

// Back-compat: any remaining dangerouslySetInnerHTML consumers still work
// because browser SVG renderers resolve <image href>. Prefer ADITS_LOGO_URL
// with <img> for new code.
export const ADITS_LOGO_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><image href="${ADITS_LOGO_URL}" width="24" height="24"/></svg>`
