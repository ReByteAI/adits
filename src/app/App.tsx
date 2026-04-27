import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './query-client.ts'
import SignInPage from './components/SignInPage.tsx'
import { AuthProvider } from './auth.tsx'
import { SignedInGate, SignedOutGate } from './auth-shim.tsx'
import V2App from './workspace-v2/V2App'

export default function App() {
  return (
    <>
      <SignedOutGate>
        <SignInPage />
      </SignedOutGate>
      <SignedInGate>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <V2App />
          </AuthProvider>
        </QueryClientProvider>
      </SignedInGate>
    </>
  )
}
