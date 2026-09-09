// Family Memory Book fork: decides, once, whether AuthenticatedShell (__root.tsx) shows upstream's
// OnboardingWizard, the "Create your family" screen, or the normal app. Extracted into its own hook
// (mirrors useWorkspaceOpen.ts's shape) so the stability guarantee below is directly testable --
// see useOnboardingGate.test.tsx.

import { useEffect, useState } from 'react'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { logRpcFailure } from './rpcErrors'
import { asFamilyOnboardingApi } from './familyOnboardingApi'
import { resolveOnboardingGate, OnboardingGateDecision } from './onboardingGate'

export interface OnboardingGateState {
  /** null while the one-time check is still pending. */
  gate: OnboardingGateDecision | null
  /** Ground truth from checkFamilyOnboarding(), independent of `gate` -- see UserMenu's manual entry. */
  needsCreateFamily: boolean
  /** True once openCreateFamily() has been used to show CreateFamilyScreen outside the automatic gate. */
  manualCreateFamily: boolean
  /** Opens CreateFamilyScreen on demand (e.g. from UserMenu), regardless of `gate`. */
  openCreateFamily: () => void
  /** Call once createFamily() succeeds or upstream's wizard completes, to move on to the app. */
  markComplete: () => void
}

/**
 * Runs the onboarding check exactly once per mount and never re-derives it afterwards.
 *
 * This is the fix for a real production bug: `authenticatedApi` gets a brand-new stub reference
 * not only at sign-in but on every RPC reconnect (main.tsx's handleBroken() replaces `currentStub`
 * on any dropped connection -- an ordinary, expected event, not a rare edge case -- which flows
 * into useAuth.ts's `[publicApi]`-keyed effect re-authenticating with the stored token). Before
 * this hook existed, the gate-computing effect was keyed on `[authenticatedApi, isAdmin]`, so a
 * reconnect moments after the user landed on "Create your family" would restart the whole check
 * against the fresh stub; if that second attempt's RPCs raced a not-yet-fully-warm connection and
 * one of them rejected, the catch block's deliberate fail-open (`setGate('app')`) silently yanked
 * the screen away with no way back -- exactly the "appears and closes within a fraction of a
 * second" bug. There is no legitimate reason to re-decide onboarding mid-session: a family, once
 * absent, doesn't need re-confirming on every reconnect. The `gate !== null` guard below makes the
 * decision sticky -- only `markComplete()` (called from CreateFamilyScreen's onComplete or
 * OnboardingWizard's onComplete) can move it forward.
 *
 * Also folds `amIAdmin()` into the same one-shot check rather than reading it from AuthContext:
 * that context defaults isAdmin to `false` until its own async fetch resolves, which raced this
 * effect the same way -- an admin whose `amIAdmin()` hadn't resolved yet could be computed as a
 * non-admin on the very first (and, per the sticky guard, ONLY) run.
 */
export function useOnboardingGate(authenticatedApi: RpcStub<AuthenticatedApi>): OnboardingGateState {
  const [gate, setGate] = useState<OnboardingGateDecision | null>(null)
  const [needsCreateFamily, setNeedsCreateFamily] = useState(false)
  const [manualCreateFamily, setManualCreateFamily] = useState(false)

  useEffect(() => {
    if (gate !== null) return
    let cancelled = false

    async function check() {
      try {
        const [isAdmin, upstreamOnboardingCompleted, familyStatus] = await Promise.all([
          authenticatedApi.amIAdmin(),
          authenticatedApi.isOnboardingCompleted(),
          asFamilyOnboardingApi(authenticatedApi).checkFamilyOnboarding(),
        ])
        if (cancelled) return
        setNeedsCreateFamily(familyStatus.needsCreateFamily)
        setGate(resolveOnboardingGate({
          isAdmin,
          upstreamOnboardingCompleted,
          needsCreateFamily: familyStatus.needsCreateFamily,
        }))
      } catch (err) {
        logRpcFailure('Failed to check onboarding status:', err)
        // If the check fails, skip onboarding to avoid blocking the user.
        if (!cancelled) setGate('app')
      }
    }

    check()
    return () => { cancelled = true }
  }, [authenticatedApi, gate])

  return {
    gate,
    needsCreateFamily,
    manualCreateFamily,
    openCreateFamily: () => setManualCreateFamily(true),
    markComplete: () => {
      setNeedsCreateFamily(false)
      setManualCreateFamily(false)
      setGate('app')
    },
  }
}
