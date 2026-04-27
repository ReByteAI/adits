import { useMemo, type ReactNode } from 'react'
import { ClerkProvider } from '@clerk/clerk-react'
import { useTranslation } from 'react-i18next'
import {
  enUS, zhCN, jaJP, ruRU,
  plPL, esES, itIT, ptBR, caES,
  deDE, frFR, nlNL, trTR, svSE, daDK,
  koKR, arSA, hiIN, thTH, viVN,
} from '@clerk/localizations'
import type { SupportedLanguage } from './index'

const clerkLocales: Record<SupportedLanguage, typeof enUS> = {
  en: enUS,
  zh: zhCN,
  ja: jaJP,
  ru: ruRU,
  pl: plPL,
  es: esES,
  it: itIT,
  pt: ptBR,
  ca: caES,
  de: deDE,
  fr: frFR,
  nl: nlNL,
  tr: trTR,
  sv: svSE,
  da: daDK,
  ko: koKR,
  ar: arSA,
  hi: hiIN,
  th: thTH,
  vi: viVN,
}

/** Module-scope so the reference is stable across every render of
 *  `ClerkLocaleProvider`. Inlining `{ variables: {...} }` as a JSX prop
 *  produces a fresh object identity per render, which `ClerkProvider`
 *  treats as a config change and re-runs its setup effects against — a
 *  parent re-render cascade then loops React's passive-update guard
 *  ("Maximum update depth exceeded"). */
const APPEARANCE = {
  variables: {
    colorPrimary: '#1B365D',
    fontFamily: '"Inter", system-ui, sans-serif',
    borderRadius: '0.75rem',
  },
} as const

interface Props {
  publishableKey: string
  children: ReactNode
}

export function ClerkLocaleProvider({ publishableKey, children }: Props) {
  const { i18n } = useTranslation()
  const base = (i18n.language?.split('-')[0] || 'en') as SupportedLanguage
  // Memoize on the resolved base so a new render with the same language
  // returns the identical reference. Even though the underlying value
  // from `clerkLocales[base]` IS a stable module-scope object, going
  // through useMemo makes the intent explicit and protects against
  // future refactors that swap the lookup for a derived object.
  const localization = useMemo(() => clerkLocales[base] ?? enUS, [base])

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={localization}
      appearance={APPEARANCE}
    >
      {children}
    </ClerkProvider>
  )
}
