import { useTranslation } from 'react-i18next'
import { supportedLanguages, languageNames, type SupportedLanguage } from './index'
import { authFetch, apiUrl } from '../api'
import { IS_LOCAL_BACKEND } from '../auth-shim.tsx'

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const current = (i18n.language?.split('-')[0] || 'en') as SupportedLanguage

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const lang = e.target.value
    await i18n.changeLanguage(lang)
    if (!IS_LOCAL_BACKEND) {
      try {
        await authFetch(apiUrl('/user/language'), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: lang }),
        })
      } catch {
        // Non-fatal — local change already took effect.
      }
    }
  }

  return (
    <label className={`lang-switcher${className ? ' ' + className : ''}`}>
      <span className="sr-only">{t('language.label')}</span>
      <select
        className="lang-switcher-select"
        value={current}
        onChange={onChange}
        aria-label={t('language.change')}
      >
        {supportedLanguages.map((lang) => (
          <option key={lang} value={lang}>
            {languageNames[lang]}
          </option>
        ))}
      </select>
    </label>
  )
}
