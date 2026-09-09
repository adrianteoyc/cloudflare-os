import { logRpcFailure } from '../rpcErrors'
import { useState, useEffect } from 'react'
import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
import { TooltipProvider, Toasty } from '@cloudflare/kumo'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useRpcStub, useConnectionLost } from '../RpcContext'
import { markConnectionRestored } from '../main'
import { useAuth, CF_ACCESS_MODE } from '../useAuth'
import { AuthProvider, useAuthenticatedApi } from '../AuthContext'
import { FeatureFlagsProvider } from '../FeatureFlagsContext'
import Header from '../components/Header'
import AppShell from '../components/AppShell/AppShell'
import LoginPage from '../LoginPage'
import OnboardingWizard from '../OnboardingWizard'
// Family Memory Book fork: see docs/UPSTREAM.md's "Create-family onboarding integration" note.
import CreateFamilyScreen from '../CreateFamilyScreen'
import { asFamilyOnboardingApi } from '../familyOnboardingApi'
import { resolveOnboardingGate, OnboardingGateDecision } from '../onboardingGate'
import { FamilyOnboardingProvider } from '../FamilyOnboardingContext'
import AccountSelectionModal from '../components/billing/AccountSelectionModal'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const rpcStub = useRpcStub()
  const connectionLost = useConnectionLost()
  const { isAuthenticated, authenticatedApi, isLoading, error, logout, login } = useAuth(rpcStub)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // When authenticatedApi becomes available, the connection is proven alive.
  useEffect(() => {
    if (authenticatedApi) markConnectionRestored()
  }, [authenticatedApi])

  // Routes that don't require auth (public routes)
  const isSignup = pathname === '/signup'
  const isBlueprint = pathname.startsWith('/blueprint/')

  // A standalone (no app shell) render is used only for signed-out visitors of public routes.
  // Signed-in users get the full app chrome so public pages (esp. the blueprint detail) feel
  // native — sidebar and all — instead of floating on a bare page.
  const standalone = isSignup || (isBlueprint && !isAuthenticated)

  // The workspace editor renders fullscreen (no app chrome). /gadget/ is the legacy URL, kept
  // here so the chrome doesn't flash in during the redirect to /workspace/.
  const isWorkspaceEditor = pathname.startsWith('/workspace/') || pathname.startsWith('/gadget/')

  const handleLoginSuccess = () => {
    const token = localStorage.getItem('authToken')
    if (token) {
      login(token)
    }
  }

  // Loading state
  if (isLoading && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base">
        <div className="w-8 h-8 border-2 border-kumo-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-kumo-subtle">{connectionLost ? 'Waiting for server…' : 'Loading...'}</p>
      </div>
    )
  }

  // Auth error
  if (error && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base p-6">
        <p className="text-sm text-kumo-danger">Authentication error: {error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm font-medium text-kumo-inverse bg-kumo-brand rounded-lg hover:bg-kumo-brand-hover transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // CF Access mode: show spinner while pipelined auth resolves
  if (!isAuthenticated && CF_ACCESS_MODE && !standalone) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base">
        <div className="w-8 h-8 border-2 border-kumo-brand border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-kumo-subtle">Authenticating...</p>
      </div>
    )
  }

  // Not authenticated and not a public route — show login
  if (!isAuthenticated && !standalone) {
    return <LoginPage rpcStub={rpcStub} onLoginSuccess={handleLoginSuccess} />
  }

  // Signed-out visitors of public routes render without the auth wrapper / app shell.
  if (standalone) {
    const showHeader = !isSignup
    return (
      <TooltipProvider>
        <Toasty>
          {showHeader && <Header />}
          <Outlet />
        </Toasty>
      </TooltipProvider>
    )
  }

  // Authenticated — render the full shell (with onboarding gate)
  // authenticatedApi is guaranteed non-null here: isLoading, error, and
  // !isAuthenticated branches all return early above.
  if (!authenticatedApi) return null
  return (
    <AuthProvider authenticatedApi={authenticatedApi} onLogout={logout}>
      <FeatureFlagsProvider>
        <TooltipProvider>
          <Toasty>
            <AuthenticatedShell
              authenticatedApi={authenticatedApi}
              isWorkspaceEditor={isWorkspaceEditor}
            />
          </Toasty>
        </TooltipProvider>
      </FeatureFlagsProvider>
    </AuthProvider>
  )
}

/**
 * Inner shell that checks onboarding status and either shows upstream's wizard, the Family Memory
 * Book "Create your family" screen, or the normal app chrome. Lives inside AuthProvider so both
 * screens can use useAuthenticatedApi().
 */
function AuthenticatedShell({
  authenticatedApi,
  isWorkspaceEditor,
}: {
  authenticatedApi: RpcStub<AuthenticatedApi>
  isWorkspaceEditor: boolean
}) {
  const { isAdmin } = useAuthenticatedApi()
  // null = still checking
  const [gate, setGate] = useState<OnboardingGateDecision | null>(null)
  // Ground truth from checkFamilyOnboarding(), independent of `gate`: an admin's `gate` is never
  // 'create-family' (resolveOnboardingGate never auto-routes them there), but they still need to
  // know whether they have a family, to decide whether UserMenu's manual entry point shows.
  const [needsCreateFamily, setNeedsCreateFamily] = useState(false)
  // Set true when the manual "Create your family" entry (FamilyOnboardingContext.openCreateFamily,
  // e.g. from UserMenu) is used, rather than the automatic gate landing on 'create-family'.
  const [manualCreateFamily, setManualCreateFamily] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        // Family Memory Book fork: checkFamilyOnboarding() is not part of upstream's
        // AuthenticatedApi -- see docs/UPSTREAM.md's "Create-family onboarding integration" note.
        // Always fetched alongside isOnboardingCompleted(), admins included: resolveOnboardingGate
        // is what keeps admins off the automatic 'create-family' route, not this call -- an admin's
        // own needsCreateFamily is still true reporting, used below for the manual entry point.
        const [upstreamOnboardingCompleted, familyStatus] = await Promise.all([
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
  }, [authenticatedApi, isAdmin])

  const handleFamilyCreated = () => {
    setNeedsCreateFamily(false)
    setManualCreateFamily(false)
    setGate('app')
  }

  // Still checking onboarding status
  if (gate === null) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-kumo-base">
        <div className="w-8 h-8 border-2 border-kumo-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (gate === 'upstream-wizard') {
    return <OnboardingWizard onComplete={() => setGate('app')} />
  }

  // Automatic (non-admin, no family) or manual (any user, e.g. an admin via UserMenu) -- the same
  // screen either way.
  if (gate === 'create-family' || manualCreateFamily) {
    return (
      <CreateFamilyScreen
        authenticatedApi={authenticatedApi}
        onComplete={handleFamilyCreated}
      />
    )
  }

  // Normal app shell. The workspace editor is rendered fullscreen (no chrome); everything else
  // gets the persistent left-rail AppShell. Connection loss is surfaced by a chip in whichever of
  // those two top bars is showing, never by a banner that reflows the page (see ReconnectingChip).
  const fullscreen = isWorkspaceEditor
  return (
    <FamilyOnboardingProvider
      needsCreateFamily={needsCreateFamily}
      openCreateFamily={() => setManualCreateFamily(true)}
    >
      <AccountSelectionModal />
      {fullscreen ? (
        <main>
          <Outlet />
        </main>
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
    </FamilyOnboardingProvider>
  )
}
