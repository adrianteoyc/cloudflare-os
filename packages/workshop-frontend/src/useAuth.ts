import { useState, useEffect, useRef } from 'react'
import { RpcStub } from 'capnweb'
import { PublicApi, AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { setReportedUserId } from './errorReporting'

const CF_ACCESS_MODE = import.meta.env.VITE_CF_ACCESS_MODE === 'true'

// Family Memory Book fork: see docs/UPSTREAM.md's "Create-family onboarding integration" note.
// Ends the Clerk session itself, not just this deployment's local OS session -- disposing the
// authenticatedApi stub below has no way to reach Clerk's own session cookie, which lives on
// Clerk's frontend-API domain, not this app's. Loads packages/clerk-auth-gatekeeper's sign-out
// page (served through the router at this same path, like the sign-in page) in a hidden iframe and
// calls Clerk.signOut() there; Clerk JS talks to Clerk's domain regardless of which origin embeds
// it, which is also what lets the existing sign-in page work from here. Fire-and-forget: logout
// must feel instant locally regardless of how this resolves, and it degrades harmlessly on a
// deployment that doesn't use the Clerk Gatekeeper (the router 404s, or clerk-auth-gatekeeper's own
// "not configured" page loads and never posts a message -- either way the failsafe timeout below
// just removes the iframe).
function endClerkSession(): void {
  const iframe = document.createElement('iframe')
  iframe.src = '/gatekeeper/clerk/sign-out'
  iframe.style.display = 'none'
  iframe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(iframe)

  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    window.removeEventListener('message', onMessage)
    iframe.remove()
  }
  function onMessage(event: MessageEvent) {
    if (event.source !== iframe.contentWindow) return
    if (event.data?.type === 'clerk-signed-out' || event.data?.type === 'clerk-sign-out-failed') {
      cleanup()
    }
  }
  window.addEventListener('message', onMessage)
  setTimeout(cleanup, 5000)
}

interface AuthState {
  token: string | null
  authenticatedApi: RpcStub<AuthenticatedApi> | null
  isLoading: boolean
  error: string | null
}

export { CF_ACCESS_MODE }

export function useAuth(publicApi: RpcStub<PublicApi>) {
  const [authState, setAuthState] = useState<AuthState>({
    token: null,
    authenticatedApi: null,
    isLoading: true,
    error: null
  })

  // Track current authenticated API stub for cleanup on unmount.
  // State closures go stale in cleanup functions, so we use a ref.
  const authenticatedApiRef = useRef<RpcStub<AuthenticatedApi> | null>(null)
  authenticatedApiRef.current = authState.authenticatedApi

  /**
   * Names the signed-in user on error reports, for as long as this stub is the current one.
   *
   * Keyed on the stub rather than called from each authenticate path, so it covers however the
   * session was established — stored token, inline login, or CF Access. This is why the claim lives
   * in the hook and not in `AuthProvider`: the public blueprint page renders outside that provider
   * and logs in inline, so reports from the rest of its session would otherwise name nobody.
   *
   * `whoami` is pipelined rather than awaited, so its answer can outlive the session that asked.
   * The cleanup drops it when the stub is replaced or cleared, which is what stops a logout or a
   * newer login from being overwritten by the previous user. Disposal would not be enough on its
   * own: capnweb does not guarantee that disposing a stub rejects calls already in flight.
   *
   * Nothing is cleared here. Cleanup also runs on unmount, and two instances of this hook can be
   * mounted at once — the blueprint page runs its own inside the root's — so an inner one going
   * away must not blank an identity the outer still holds. `logout` is the only thing that clears.
   */
  useEffect(() => {
    const authenticatedApi = authState.authenticatedApi
    if (!authenticatedApi) return
    let cancelled = false
    authenticatedApi.whoami().then((info) => {
      // Only a real user account names a person: for a gadget author `id` is its owner's id.
      if (!cancelled && info.type === 'user') setReportedUserId(info.id)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [authState.authenticatedApi])

  useEffect(() => {
    if (CF_ACCESS_MODE) {
      authenticateWithCfAccess()
    } else {
      const storedToken = localStorage.getItem('authToken')
      if (storedToken) {
        authenticateWithToken(storedToken)
      } else {
        setAuthState(prev => ({ ...prev, isLoading: false }))
      }
    }
    return () => {
      // The authenticateWithXxx functions also dispose the old stub via their setAuthState
      // updater, so this may double-dispose on reconnect. That's fine — dispose is idempotent.
      authenticatedApiRef.current?.[Symbol.dispose]()
    }
  }, [publicApi])

  const authenticateWithCfAccess = () => {
    setAuthState(prev => {
      if (prev.authenticatedApi) {
        prev.authenticatedApi[Symbol.dispose]()
      }
      return { ...prev, authenticatedApi: null, isLoading: true, error: null }
    })

    // Use promise pipelining - no need to await. The CF Access JWT is already attached
    // to the request by the browser (injected by the Access service worker/cookie), so
    // the server validates it and returns an authenticated stub immediately.
    const authenticatedApi = publicApi.authenticateFromCfAccess()
    setAuthState({
      token: null,
      authenticatedApi,
      isLoading: false,
      error: null
    })
  }

  const authenticateWithToken = (token: string) => {
    setAuthState(prev => {
      // Dispose the previous authenticated API stub if it exists
      if (prev.authenticatedApi) {
        prev.authenticatedApi[Symbol.dispose]()
      }
      return {
        ...prev,
        authenticatedApi: null, // Clear the disposed stub
        isLoading: true,
        error: null
      }
    })

    // Use promise pipelining - we can use the returned promise as a stub immediately
    // without awaiting. Authentication errors will be handled when the stub is actually used.
    const authenticatedApi = publicApi.authenticate(token)
    setAuthState({
      token,
      authenticatedApi,
      isLoading: false,
      error: null
    })
  }

  const login = (token: string) => {
    authenticateWithToken(token)
  }

  const logout = () => {
    setReportedUserId(undefined)

    if (CF_ACCESS_MODE) {
      window.location.assign('/cdn-cgi/access/logout')
      return
    }

    // Use functional updater to read current state (avoids stale closure).
    setAuthState(prev => {
      if (prev.authenticatedApi) {
        prev.authenticatedApi[Symbol.dispose]()
      }
      return {
        token: null,
        authenticatedApi: null,
        isLoading: false,
        error: null
      }
    })

    localStorage.removeItem('authToken')
    endClerkSession()
  }

  return {
    ...authState,
    login,
    logout,
    isAuthenticated: !!authState.authenticatedApi
  }
}
