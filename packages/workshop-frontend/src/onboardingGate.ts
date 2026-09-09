export type OnboardingGateDecision = 'upstream-wizard' | 'create-family' | 'app'

/**
 * Family Memory Book fork: decides what AuthenticatedShell (__root.tsx) renders before the normal
 * app chrome. Admins keep upstream's own onboarding untouched -- routed purely off
 * upstreamOnboardingCompleted, same as before this fork. Everyone else either sees "Create your
 * family" (no family yet) or skips straight to the app -- including skipping upstream's
 * OnboardingWizard, which knows nothing about families. See docs/UPSTREAM.md's "Create-family
 * onboarding integration" note.
 */
export function resolveOnboardingGate(params: {
  isAdmin: boolean
  upstreamOnboardingCompleted: boolean
  needsCreateFamily: boolean
}): OnboardingGateDecision {
  if (params.isAdmin) {
    return params.upstreamOnboardingCompleted ? 'app' : 'upstream-wizard'
  }
  return params.needsCreateFamily ? 'create-family' : 'app'
}
