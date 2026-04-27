import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { IS_LOCAL_BACKEND } from './auth-shim.tsx'

// Pull the stylesheets into the JS graph so Vite emits content-hashed
// copies under build/assets/. app.html drops its `<link rel="stylesheet">`
// tags for these and lets Vite inject the hashed references instead, which
// is the only reliable cache-busting story for unhashed /css/*.css on
// Cloudflare Pages (max-age=14400, must-revalidate — i.e. stale reads for
// up to four hours after a deploy). The files stay on disk at public/css/
// as the source of truth so the marketing HTML pages and ui-elements.html
// keep their verbatim /css/*.css references.
import '../../public/css/main.css'
import '../../public/css/app.css'

// Initialize i18n before anything renders — `useTranslation()` consumers
// suspend on first namespace load, so the Suspense boundary below catches
// the initial paint.
import './i18n'
import { ClerkLocaleProvider } from './i18n/ClerkLocaleProvider.tsx'

const root = createRoot(document.getElementById('root')!)

const fallback = <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }} />

if (IS_LOCAL_BACKEND) {
  // Single-user OSS build — no Clerk, no sign-in UI. auth-shim returns a
  // fixed 'local' user and SignedInGate always renders.
  root.render(<Suspense fallback={fallback}><App /></Suspense>)
} else {
  const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  if (!PUBLISHABLE_KEY) {
    throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY environment variable')
  }
  root.render(
    <Suspense fallback={fallback}>
      <ClerkLocaleProvider publishableKey={PUBLISHABLE_KEY}>
        <App />
      </ClerkLocaleProvider>
    </Suspense>,
  )
}
