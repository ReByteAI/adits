import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { authFetch, apiUrl } from '../api'
import { IS_LOCAL_BACKEND, useCurrentUser } from '../auth-shim.tsx'

/**
 * Two-way sync between local i18n and Clerk publicMetadata.language.
 *
 * On first load while signed in (rebyte mode):
 *  - if Clerk has a saved language → apply it locally (cross-device sync).
 *  - if not → push the current local language to Clerk.
 *
 * No-op in local-backend mode.
 */
export function useLanguageSync() {
  const { user, isLoaded } = useCurrentUser()
  const { i18n } = useTranslation()
  const synced = useRef(false)

  useEffect(() => {
    if (IS_LOCAL_BACKEND) return
    if (!isLoaded || synced.current || !user) return

    const meta = (user as { publicMetadata?: { language?: string } }).publicMetadata
    const clerkLang = meta?.language
    const localLang = (i18n.language || 'en').split('-')[0]

    if (clerkLang) {
      if (clerkLang !== localLang) {
        i18n.changeLanguage(clerkLang).catch(() => {})
      }
    } else {
      authFetch(apiUrl('/user/language'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language: localLang }),
      }).catch(() => {})
    }

    synced.current = true
  }, [isLoaded, user, i18n])
}
