// Family Memory Book fork: decides, once, whether AuthenticatedShell (__root.tsx) shows upstream's
// OnboardingWizard, the "Create your family" screen, the normal app, or (after retries fail) an
// error state with a manual retry. Extracted into its own hook (mirrors useWorkspaceOpen.ts's
// shape) so the stability guarantee below is directly testable -- see useOnboardingGate.test.tsx.

import { useEffect, useState } from 'react'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { logRpcFailure } from './rpcErrors'
import { asFamilyOnboardingApi } from './familyOnboardingApi'
import { resolveOnboardingGate, OnboardingGateDecision } from './onboardingGate'

/** `resolveOnboardingGate`'s own outcomes, plus 'error' -- the check itself never produces this;
 *  only the hook's retry-exhaustion path does. */
export type OnboardingGateStatus = OnboardingGateDecision | 'error'

const MAX_ATTEMPTS = 3
// Delay before attempt 2, then before attempt 3 -- one entry per retry, not per attempt.
const DEFAULT_RETRY_DELAYS_MS = [500, 1500]

export interface OnboardingGateState {
  /** null while checking (including between retries); 'error' once all attempts are exhausted. */
  gate: OnboardingGateStatus | null
  /** Ground truth from checkFamilyOnboarding(), independent of `gate` -- see UserMenu's manual entry. */
  needsCreateFamily: boolean
  /** True once openCreateFamily() has been used to show CreateFamilyScreen outside the automatic gate. */
  manualCreateFamily: boolean
  /** Opens CreateFamilyScreen on demand (e.g. from UserMenu), regardless of `gate`. */
  openCreateFamily: () => void
  /** Call once createFamily() succeeds or upstream's wizard completes, to move on to the app. */
  markComplete: () => void
  /** Call from the error state's "Try again" button. Starts a fresh 3-attempt check from scratch. */
  retry: () => void
}

/**
 * Runs the onboarding check once per mount (or per `retry()`) and never silently re-derives it
 * otherwise.
 *
 * This is the fix for a real production bug: `authenticatedApi` gets a brand-new stub reference
 * not only at sign-in but on every RPC reconnect (main.tsx's handleBroken() replaces `currentStub`
 * on any dropped connection -- an ordinary, expected event, not a rare edge case -- which flows
 * into useAuth.ts's `[publicApi]`-keyed effect re-authenticating with the stored token). Before
 * this hook existed, the gate-computing effect was keyed on `[authenticatedApi, isAdmin]`, so a
 * reconnect moments after the user landed on "Create your family" would restart the whole check
 * against the fresh stub; if that second attempt's RPCs raced a not-yet-fully-warm connection and
 * one of them rejected, the catch block's fail-open (`setGate('app')`) silently yanked the screen
 * away with no way back. The `gate !== null` guard below makes the decision sticky -- only
 * `markComplete()` or `retry()` can move it.
 *
 * The check itself retries up to `MAX_ATTEMPTS` times with a short backoff before giving up.
 * Failing open to 'app' on a transient error was itself a bug in the other direction: a
 * family-less user who hit one bad RPC at first load would be dropped straight into the app with
 * no family and nothing left to ever recheck. After the last attempt fails, `gate` becomes
 * 'error' instead -- AuthenticatedShell renders a "Try again" button (retry()) rather than the
 * app. `resolveOnboardingGate` itself is never called with fabricated data to manufacture an
 * 'app'/'create-family' outcome on failure; the whole point is that only a genuinely successful
 * check may produce one.
 *
 * Also folds `amIAdmin()` into the same check rather than reading it from AuthContext: that
 * context defaults isAdmin to `false` until its own async fetch resolves, which raced this effect
 * the same way -- an admin whose `amIAdmin()` hadn't resolved yet could be computed as a
 * non-admin on the very first (and, per the sticky guard, otherwise only) run.
 */
export function useOnboardingGate(
  authenticatedApi: RpcStub<AuthenticatedApi>,
  retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): OnboardingGateState {
  const [gate, setGate] = useState<OnboardingGateStatus | null>(null)
  const [needsCreateFamily, setNeedsCreateFamily] = useState(false)
  const [manualCreateFamily, setManualCreateFamily] = useState(false)

  useEffect(() => {
    if (gate !== null) return
    let cancelled = false

    async function attempt(attemptNumber: number): Promise<void> {
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
        if (cancelled) return
        logRpcFailure(`Onboarding check failed (attempt ${attemptNumber}/${MAX_ATTEMPTS}):`, err)
        if (attemptNumber >= MAX_ATTEMPTS) {
          // Never fail open to 'app': a family-less user needs a retry path, not to silently lose
          // "Create your family" because one RPC hiccupped at first load.
          setGate('error')
          return
        }
        const delay = retryDelaysMs[attemptNumber - 1] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 0
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (cancelled) return
        await attempt(attemptNumber + 1)
      }
    }

    attempt(1)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retryDelaysMs is a config value the
    // caller passes once; re-running on every array-identity change would defeat the sticky guard.
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
    // Setting gate back to null is enough: it's in the effect's own dependency array, so this
    // alone re-triggers a fresh attempt(1) -- no separate "attempt count" state needed.
    retry: () => setGate(null),
  }
}
