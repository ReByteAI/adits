import { useEffect, useState } from 'react'
import { apiUrl, authFetch } from '../api.ts'

interface CreditPack {
  key: string
  label: string
  credits: number
  amountUsd: number
}

interface CreditState {
  balance: number
  totalAvailable: number
  lifetimePurchased: number
  lifetimeUsed: number
  packs: CreditPack[]
}

export default function CreditsDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [data, setData] = useState<CreditState | null>(null)
  const [loading, setLoading] = useState(false)
  const [purchaseKey, setPurchaseKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    void authFetch(apiUrl('/billing/credits'))
      .then(async res => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(json.error ?? `API ${res.status}`)
        }
        return res.json() as Promise<CreditState>
      })
      .then(setData)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [open])

  const startCheckout = async (packKey: string) => {
    setPurchaseKey(packKey)
    setError(null)
    try {
      const res = await authFetch(apiUrl('/billing/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packKey }),
      })
      const json = await res.json() as { checkoutUrl?: string; error?: string }
      if (!res.ok || !json.checkoutUrl) throw new Error(json.error ?? 'Failed to start checkout')
      window.location.href = json.checkoutUrl
    } catch (err) {
      setError((err as Error).message)
      setPurchaseKey(null)
    }
  }

  if (!open) return null

  return (
    <div className="adits-credits-backdrop" onClick={onClose}>
      <div className="adits-credits-dialog" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="adits-credits-header">
          <div>
            <div className="adits-credits-kicker">Billing</div>
            <h2 className="adits-credits-title">Buy credits</h2>
          </div>
          <button type="button" className="adits-credits-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading && <div className="adits-credits-note">Loading credits…</div>}
        {error && <div className="adits-credits-error">{error}</div>}

        {data && (
          <>
            <div className="adits-credits-balance">
              <div className="adits-credits-balance-card">
                <span className="adits-credits-balance-label">Available now</span>
                <strong>{data.totalAvailable.toLocaleString()} credits</strong>
              </div>
              <div className="adits-credits-balance-card">
                <span className="adits-credits-balance-label">Purchased balance</span>
                <strong>{data.balance.toLocaleString()} credits</strong>
              </div>
            </div>

            <div className="adits-credits-meta">
              <span>Purchased lifetime: {data.lifetimePurchased.toLocaleString()}</span>
              <span>Used lifetime: {data.lifetimeUsed.toLocaleString()}</span>
            </div>

            <div className="adits-credits-packs">
              {data.packs.map(pack => (
                <button
                  key={pack.key}
                  type="button"
                  className="adits-credits-pack"
                  onClick={() => void startCheckout(pack.key)}
                  disabled={purchaseKey !== null}
                >
                  <span className="adits-credits-pack-price">{pack.label}</span>
                  <span className="adits-credits-pack-amount">{pack.credits.toLocaleString()} credits</span>
                  <span className="adits-credits-pack-foot">Pay with Stripe</span>
                  <span className="adits-credits-pack-cta">
                    {purchaseKey === pack.key ? 'Redirecting…' : 'Buy'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
