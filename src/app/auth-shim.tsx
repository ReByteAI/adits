/**
 * Auth-backend shim. Every component that needs "who is the current user"
 * or "are we signed in" goes through this module instead of importing
 * @clerk/clerk-react directly. Build-time `VITE_ADITS_BACKEND` selects the
 * implementation: `rebyte` delegates to Clerk; `local` returns a fixed
 * stub user ('local@localhost') and treats everyone as signed in.
 *
 * Keeping the Clerk imports here means call sites don't touch Clerk, and
 * in local mode we can skip mounting `<ClerkProvider>` at all (see
 * main.tsx). The conditional hook calls are build-time constants, not
 * runtime branches — fine for the Rules of Hooks even though eslint
 * doesn't know that.
 */

import type { ReactNode } from 'react'
import {
  SignedIn as ClerkSignedIn,
  SignedOut as ClerkSignedOut,
  useUser as useClerkUser,
  useClerk,
} from '@clerk/clerk-react'

export const IS_LOCAL_BACKEND = import.meta.env.VITE_ADITS_BACKEND === 'local'

/** Stub user for local mode. Must satisfy the fields the rest of the app
 *  reads off the Clerk user object (email, name, avatar, id). */
const LOCAL_USER = {
  id: 'local',
  primaryEmailAddress: { emailAddress: 'local@localhost' },
  emailAddresses: [{ emailAddress: 'local@localhost' }],
  fullName: 'Local User',
  firstName: 'Local',
  imageUrl: '',
  organizationMemberships: [] as Array<{ organization: { name: string } }>,
} as const

/** Current user + loading state. In local mode, always loaded + present. */
export function useCurrentUser(): { user: typeof LOCAL_USER | ReturnType<typeof useClerkUser>['user']; isLoaded: boolean } {
  if (IS_LOCAL_BACKEND) {
    return { user: LOCAL_USER, isLoaded: true }
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user, isLoaded } = useClerkUser()
  return { user, isLoaded }
}

/** Sign-out + open-profile hooks. In local mode both are no-ops — there's
 *  no account to sign out of and no profile UI to open. */
export function useAccountActions(): { signOut: () => Promise<void>; openUserProfile: () => void } {
  if (IS_LOCAL_BACKEND) {
    return {
      signOut: async () => { /* no-op in local mode */ },
      openUserProfile: () => { /* no-op in local mode */ },
    }
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { signOut, openUserProfile } = useClerk()
  return {
    signOut: async () => { await signOut() },
    openUserProfile: () => { openUserProfile() },
  }
}

/** Render children iff the user is signed in. Local mode: always renders. */
export function SignedInGate({ children }: { children: ReactNode }) {
  if (IS_LOCAL_BACKEND) return <>{children}</>
  return <ClerkSignedIn>{children}</ClerkSignedIn>
}

/** Render children iff the user is signed out. Local mode: never renders
 *  (there's no sign-out state). */
export function SignedOutGate({ children }: { children: ReactNode }) {
  if (IS_LOCAL_BACKEND) return null
  return <ClerkSignedOut>{children}</ClerkSignedOut>
}
