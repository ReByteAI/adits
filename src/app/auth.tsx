/**
 * Auth provider — refreshes Clerk token every 50s and exposes it globally.
 * One provider at the top, children call useAuthToken().
 */
import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth as useClerkAuth } from '@clerk/clerk-react'
import { setTokenGetter } from './api.ts'
import { IS_LOCAL_BACKEND, useCurrentUser } from './auth-shim.tsx'

interface AuthContextType {
  token: string | null
  loading: boolean
  user: ReturnType<typeof useCurrentUser>['user']
  getToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Stub Clerk auth hook shape for local mode — always signed in, always
 *  loaded, token is empty (the backend's passthrough middleware doesn't
 *  check it). */
function useLocalAuthStub() {
  return {
    isSignedIn: true,
    isLoaded: true,
    getToken: async () => '',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Rules-of-hooks note: IS_LOCAL_BACKEND is a build-time constant, so the
  // branch never flips between renders.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { isSignedIn, isLoaded, getToken } = IS_LOCAL_BACKEND ? useLocalAuthStub() : useClerkAuth()
  const { user } = useCurrentUser()
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshToken = useCallback(async () => {
    if (!isSignedIn) {
      setToken(null)
      setLoading(false)
      return
    }
    try {
      const t = await getToken()
      setToken(t)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [isSignedIn, getToken])

  // Initial fetch + refresh every 50s
  useEffect(() => {
    if (!isLoaded) return
    if (intervalRef.current) clearInterval(intervalRef.current)

    if (isSignedIn) {
      setLoading(true)
      refreshToken()
      intervalRef.current = setInterval(refreshToken, 50000)
    } else {
      setToken(null)
      setLoading(false)
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isLoaded, isSignedIn, refreshToken])

  // Register global token getter for api.ts — must be synchronous (not in useEffect)
  // so it's available before any child component's useEffect fires
  setTokenGetter(() => getToken())

  const memoizedGetToken = useCallback(async () => {
    if (!isSignedIn) return null
    try { return await getToken() } catch { return null }
  }, [isSignedIn, getToken])

  const value = useMemo(() => ({
    token, loading, user, getToken: memoizedGetToken,
  }), [token, loading, user, memoizedGetToken])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthToken(): string | null {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthToken must be inside AuthProvider')
  return ctx.token
}

export function useAuthUser() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthUser must be inside AuthProvider')
  return ctx.user
}

export function useAuthGetToken() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthGetToken must be inside AuthProvider')
  return ctx.getToken
}
