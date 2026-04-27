import { SignIn } from '@clerk/clerk-react'
import { useTranslation } from 'react-i18next'
import { ADITS_LOGO_URL } from '../../../packages/shared/logo'

export default function SignInPage() {
  const { t } = useTranslation('auth')
  return (
    <div className="signin-page">
      <div className="grain-overlay" aria-hidden="true" />
      <div className="signin-container">
        <div className="signin-header">
          <a href="/" className="app-logo" aria-label={t('signIn.backToHome')}>
            <span className="app-logo-mark" aria-hidden="true">
              <img src={ADITS_LOGO_URL} alt="" />
            </span>
            <span className="app-logo-text">Adits</span>
          </a>
          <p className="signin-subtitle">{t('signIn.tagline')}</p>
        </div>
        <SignIn
          signInFallbackRedirectUrl="/projects"
          signUpFallbackRedirectUrl="/projects"
          appearance={{
            variables: {
              colorBackground: 'var(--color-paper)',
              colorText: 'var(--color-text)',
              colorTextSecondary: 'var(--color-ash)',
              colorInputBackground: 'var(--color-paper)',
              colorInputText: 'var(--color-text)',
              colorPrimary: 'var(--color-accent)',
              colorNeutral: 'var(--color-text)',
            },
            elements: {
              rootBox: 'signin-clerk-root',
              card: 'signin-clerk-card',
              headerTitle: 'signin-clerk-title',
              headerSubtitle: 'signin-clerk-subtitle',
              socialButtonsBlockButton: 'signin-clerk-social-btn',
              footerAction: 'signin-clerk-footer',
            },
          }}
          routing="hash"
        />
      </div>
    </div>
  )
}
