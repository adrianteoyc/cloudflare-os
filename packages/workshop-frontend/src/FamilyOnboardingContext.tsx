// Family Memory Book fork: lets any component in the app shell (e.g. UserMenu's "Create your
// family" entry) know whether the current user has no family yet, and open the same
// CreateFamilyScreen __root.tsx's onboarding gate itself would show automatically for a non-admin.
// Admins never get routed there automatically (see onboardingGate.ts's resolveOnboardingGate) --
// this is their only way in. See docs/UPSTREAM.md's "Create-family onboarding integration" note.

import { createContext, useContext, ReactNode } from 'react'

interface FamilyOnboardingContextType {
  /** True once this user -- admin or not -- has no family yet. */
  needsCreateFamily: boolean
  /** Opens "Create your family" on demand, outside the automatic onboarding gate. */
  openCreateFamily: () => void
}

const FamilyOnboardingContext = createContext<FamilyOnboardingContextType | null>(null)

export function FamilyOnboardingProvider({
  needsCreateFamily,
  openCreateFamily,
  children,
}: FamilyOnboardingContextType & { children: ReactNode }) {
  return (
    <FamilyOnboardingContext.Provider value={{ needsCreateFamily, openCreateFamily }}>
      {children}
    </FamilyOnboardingContext.Provider>
  )
}

/** Null outside a FamilyOnboardingProvider (e.g. standalone/public pages, or while gate === null). */
export function useFamilyOnboarding(): FamilyOnboardingContextType | null {
  return useContext(FamilyOnboardingContext)
}
