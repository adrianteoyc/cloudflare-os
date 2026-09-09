import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'

/**
 * Family Memory Book fork: the two RPC methods packages/workshop-backend/src/server.ts's
 * AuthenticatedApiImpl adds beyond upstream's own AuthenticatedApi interface (see
 * docs/UPSTREAM.md's "Create-family onboarding integration" note). Not part of the shared
 * interface, so callers cast their `RpcStub<AuthenticatedApi>` through this type rather than
 * widening AuthenticatedApi itself.
 */
export interface FamilyOnboardingApi {
  checkFamilyOnboarding(): Promise<{ needsCreateFamily: boolean }>
  createFamily(familyName: string): Promise<void>
}

export function asFamilyOnboardingApi(
  authenticatedApi: RpcStub<AuthenticatedApi>,
): RpcStub<FamilyOnboardingApi> {
  return authenticatedApi as unknown as RpcStub<FamilyOnboardingApi>
}
