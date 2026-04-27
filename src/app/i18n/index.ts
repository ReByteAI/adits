import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'

export const supportedLanguages = [
  'en', 'zh', 'ja', 'ru',
  'pl', 'es', 'it', 'pt', 'ca',
  'de', 'fr', 'nl', 'tr', 'sv', 'da',
  'ko', 'ar', 'hi', 'th', 'vi',
] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

export const languageNames: Record<SupportedLanguage, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
  ru: 'Русский',
  pl: 'Polski',
  es: 'Español',
  it: 'Italiano',
  pt: 'Português',
  ca: 'Català',
  de: 'Deutsch',
  fr: 'Français',
  nl: 'Nederlands',
  tr: 'Türkçe',
  sv: 'Svenska',
  da: 'Dansk',
  ko: '한국어',
  ar: 'العربية',
  hi: 'हिन्दी',
  th: 'ไทย',
  vi: 'Tiếng Việt',
}

export const namespaces = [
  'common',
  'auth',
  'projects',
  'workspace',
  'chat',
  'files',
  'errors',
] as const
export type Namespace = (typeof namespaces)[number]

i18n
  .use(LanguageDetector)
  .use(
    resourcesToBackend(
      (language: string, namespace: string) =>
        import(`./locales/${language}/${namespace}.json`),
    ),
  )
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    ns: namespaces,
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['cookie', 'localStorage', 'navigator', 'htmlTag'],
      caches: ['cookie', 'localStorage'],
      lookupCookie: 'adits-lang',
      lookupLocalStorage: 'i18nextLng',
      cookieDomain: import.meta.env.DEV ? undefined : '.adits.app',
      cookieOptions: { path: '/', sameSite: 'lax' },
    },
    react: {
      useSuspense: true,
    },
  })

const rtlLanguages = ['ar']

function applyDocumentLanguage(lng: string) {
  const base = lng.split('-')[0]
  document.documentElement.lang = base
  document.documentElement.dir = rtlLanguages.includes(base) ? 'rtl' : 'ltr'
}

i18n.on('languageChanged', applyDocumentLanguage)
applyDocumentLanguage(i18n.language || 'en')

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? match[2] : null
}

if (!localStorage.getItem('i18nextLng') && !getCookie('adits-lang')) {
  fetch('/api/app/locale/detect')
    .then((res) => res.json())
    .then((data: { language?: string; source?: string }) => {
      if (data.language && data.source === 'accept-language') {
        i18n.changeLanguage(data.language)
      }
    })
    .catch(() => {
      // Ignore — fall back to navigator.language or 'en'.
    })
}

export default i18n
