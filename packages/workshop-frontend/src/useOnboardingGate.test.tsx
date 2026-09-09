// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

// Regression test for a production bug: an RPC reconnect (main.tsx's handleBroken() replacing
// currentStub -- a routine event) hands AuthenticatedShell a brand-new authenticatedApi reference,
// which used to re-run the onboarding check from scratch and could flip "Create your family" back
// to the app within a fraction of a second. See useOnboardingGate.ts's doc comment for the full
// story. These tests simulate that exact re-render (same component, new authenticatedApi prop) and
// assert the gate is sticky: decided once, never re-derived, and the underlying RPCs are never
// called a second time.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { useOnboardingGate, type OnboardingGateState } from './useOnboardingGate'

// No real waiting for retry backoff in these tests -- see GateProbe's retryDelaysMs prop.
const NO_DELAY = [0, 0];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

/** Rejects `failures` times, then resolves with `result` on every call after that. */
function flaky(failures: number, result: { needsCreateFamily: boolean }) {
  let call = 0
  return vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(() => {
    call++
    if (call <= failures) return Promise.reject(new Error(`transient failure #${call}`))
    return Promise.resolve(result)
  })
}

interface MockApiOverrides {
  amIAdmin?: () => Promise<boolean>
  isOnboardingCompleted?: () => Promise<boolean>
  checkFamilyOnboarding?: () => Promise<{ needsCreateFamily: boolean }>
}

function mockApi(overrides: MockApiOverrides = {}): RpcStub<AuthenticatedApi> {
  return {
    amIAdmin: overrides.amIAdmin ?? (() => Promise.resolve(false)),
    isOnboardingCompleted: overrides.isOnboardingCompleted ?? (() => Promise.resolve(false)),
    checkFamilyOnboarding: overrides.checkFamilyOnboarding
      ?? (() => Promise.resolve({ needsCreateFamily: true })),
  } as unknown as RpcStub<AuthenticatedApi>
}

let latestState: OnboardingGateState | null = null

function GateProbe({
  authenticatedApi,
  retryDelaysMs = NO_DELAY,
}: {
  authenticatedApi: RpcStub<AuthenticatedApi>
  retryDelaysMs?: readonly number[]
}) {
  latestState = useOnboardingGate(authenticatedApi, retryDelaysMs)
  return null
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => { root!.unmount() })
  container?.remove()
  container = null
  root = null
  latestState = null
})

function mount(authenticatedApi: RpcStub<AuthenticatedApi>) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(<GateProbe authenticatedApi={authenticatedApi} />) })
}

function rerenderWith(authenticatedApi: RpcStub<AuthenticatedApi>) {
  act(() => { root!.render(<GateProbe authenticatedApi={authenticatedApi} />) })
}

/**
 * Yields to real macrotasks, not just microtasks: retryDelaysMs uses a genuine `setTimeout` even
 * at 0ms (NO_DELAY above), so a plain `await Promise.resolve()` chain would never let a queued
 * retry fire. Each round trip is one real tick; `times` covers however many attempt -> backoff ->
 * next-attempt hops a test needs to settle (a fully-exhausted 3-attempt sequence needs at least 2).
 */
async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('useOnboardingGate', () => {
  it('stays on create-family across a re-render with a new authenticatedApi (simulated reconnect)', async () => {
    const checkFamilyOnboarding1 = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
      () => Promise.resolve({ needsCreateFamily: true }),
    )
    mount(mockApi({ checkFamilyOnboarding: checkFamilyOnboarding1 }))
    await flush()
    expect(latestState?.gate).toBe('create-family')
    expect(checkFamilyOnboarding1).toHaveBeenCalledTimes(1)

    // A reconnect hands the component a brand-new authenticatedApi stub -- same as main.tsx's
    // handleBroken() / useAuth.ts's [publicApi]-keyed re-authentication.
    const checkFamilyOnboarding2 = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
      () => Promise.resolve({ needsCreateFamily: true }),
    )
    rerenderWith(mockApi({ checkFamilyOnboarding: checkFamilyOnboarding2 }))
    await flush()

    expect(latestState?.gate).toBe('create-family')
    // The regression: no new check must run against the replacement stub once gate is decided.
    expect(checkFamilyOnboarding2).not.toHaveBeenCalled()
  })

  it('stays pending (null) across a re-render while the family check has not resolved yet', async () => {
    const pending = deferred<{ needsCreateFamily: boolean }>()
    const checkFamilyOnboarding = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(() => pending.promise)
    const api = mockApi({ checkFamilyOnboarding })
    mount(api)
    await flush()
    expect(latestState?.gate).toBeNull()

    // A re-render with the SAME api reference (e.g. an unrelated parent state update) must not
    // restart or duplicate the in-flight check.
    rerenderWith(api)
    await flush()
    expect(latestState?.gate).toBeNull()
    expect(checkFamilyOnboarding).toHaveBeenCalledTimes(1)

    pending.resolve({ needsCreateFamily: true })
    await flush()
    expect(latestState?.gate).toBe('create-family')
  })

  it('stays on app across a re-render once the family check resolves negatively (no family needed)', async () => {
    const checkFamilyOnboarding1 = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
      () => Promise.resolve({ needsCreateFamily: false }),
    )
    mount(mockApi({ checkFamilyOnboarding: checkFamilyOnboarding1 }))
    await flush()
    expect(latestState?.gate).toBe('app')

    const checkFamilyOnboarding2 = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
      () => Promise.resolve({ needsCreateFamily: true }),
    )
    rerenderWith(mockApi({ checkFamilyOnboarding: checkFamilyOnboarding2 }))
    await flush()

    // Not re-derived even though the (hypothetical) new stub would answer differently.
    expect(latestState?.gate).toBe('app')
    expect(checkFamilyOnboarding2).not.toHaveBeenCalled()
  })

  it('markComplete moves a create-family gate to app and clears needsCreateFamily', async () => {
    mount(mockApi({ checkFamilyOnboarding: () => Promise.resolve({ needsCreateFamily: true }) }))
    await flush()
    expect(latestState?.gate).toBe('create-family')
    expect(latestState?.needsCreateFamily).toBe(true)

    act(() => { latestState!.markComplete() })

    expect(latestState?.gate).toBe('app')
    expect(latestState?.needsCreateFamily).toBe(false)
  })

  it('openCreateFamily sets manualCreateFamily without touching gate', async () => {
    mount(mockApi({ checkFamilyOnboarding: () => Promise.resolve({ needsCreateFamily: false }) }))
    await flush()
    expect(latestState?.gate).toBe('app')
    expect(latestState?.manualCreateFamily).toBe(false)

    act(() => { latestState!.openCreateFamily() })

    expect(latestState?.gate).toBe('app')
    expect(latestState?.manualCreateFamily).toBe(true)
  })

  describe('retrying transient failures instead of failing open', () => {
    it('retries a transient failure and succeeds on the second attempt', async () => {
      const checkFamilyOnboarding = flaky(1, { needsCreateFamily: true })
      mount(mockApi({ checkFamilyOnboarding }))

      await flush()

      expect(latestState?.gate).toBe('create-family')
      expect(checkFamilyOnboarding).toHaveBeenCalledTimes(2)
    })

    it('retries twice more after an initial failure and still succeeds on the third attempt', async () => {
      const checkFamilyOnboarding = flaky(2, { needsCreateFamily: false })
      mount(mockApi({ checkFamilyOnboarding }))

      await flush()

      expect(latestState?.gate).toBe('app')
      expect(checkFamilyOnboarding).toHaveBeenCalledTimes(3)
    })

    it('gives up after 3 failed attempts and shows an error state -- never fails open to app', async () => {
      const checkFamilyOnboarding = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
        () => Promise.reject(new Error('still broken')),
      )
      mount(mockApi({ checkFamilyOnboarding }))

      await flush()

      expect(latestState?.gate).toBe('error')
      expect(latestState?.gate).not.toBe('app')
      expect(checkFamilyOnboarding).toHaveBeenCalledTimes(3)
    })

    it('does not keep retrying forever -- stops issuing calls once in the error state', async () => {
      const checkFamilyOnboarding = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
        () => Promise.reject(new Error('still broken')),
      )
      mount(mockApi({ checkFamilyOnboarding }))
      await flush()
      expect(latestState?.gate).toBe('error')
      const callsAtError = checkFamilyOnboarding.mock.calls.length

      await flush()

      expect(checkFamilyOnboarding).toHaveBeenCalledTimes(callsAtError)
    })

    it('retry() from the error state starts a fresh 3-attempt sequence and can succeed', async () => {
      const checkFamilyOnboarding = vi.fn<() => Promise<{ needsCreateFamily: boolean }>>(
        () => Promise.reject(new Error('still broken')),
      )
      mount(mockApi({ checkFamilyOnboarding }))
      await flush()
      expect(latestState?.gate).toBe('error')
      expect(checkFamilyOnboarding).toHaveBeenCalledTimes(3)

      // Whatever was wrong has resolved by the time the user clicks "Try again".
      checkFamilyOnboarding.mockImplementation(() => Promise.resolve({ needsCreateFamily: true }))
      act(() => { latestState!.retry() })
      expect(latestState?.gate).toBeNull()

      await flush()

      expect(latestState?.gate).toBe('create-family')
      expect(checkFamilyOnboarding).toHaveBeenCalledTimes(4)
    })
  })
})
