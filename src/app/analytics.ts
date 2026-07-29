export const GA4_MEASUREMENT_ID = 'G-BBZG5W8CNB'
export const GA4_PRODUCTION_HOSTNAME = 'adits.ai'

type Gtag = (...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

function isProductionHost(): boolean {
  return window.location.hostname === GA4_PRODUCTION_HOSTNAME
}

function pageTemplate(pathname: string): string {
  if (/^\/project\/[^/]+/.test(pathname)) return '/project/:projectId'
  if (pathname === '/projects') return '/projects'
  return '/app'
}

/**
 * Loads GA4 only on the production hostname. Page views are sent manually so
 * that dynamic identifiers (project IDs, file names, and query strings) never
 * reach Google Analytics.
 */
export function initializeAnalytics(): boolean {
  if (!isProductionHost()) return false

  window.dataLayer ??= []
  window.gtag ??= function gtag(...args: unknown[]) {
    window.dataLayer?.push(args)
  }

  if (!document.getElementById('ga4-script')) {
    const script = document.createElement('script')
    script.id = 'ga4-script'
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`
    document.head.append(script)

    window.gtag('js', new Date())
    window.gtag('config', GA4_MEASUREMENT_ID, { send_page_view: false })
  }

  return true
}

export function trackPageView(pathname = window.location.pathname): void {
  if (!initializeAnalytics()) return

  const path = pageTemplate(pathname)
  window.gtag?.('event', 'page_view', {
    page_location: `${window.location.origin}${path}`,
    page_path: path,
    page_title: 'Adits',
  })
}
