// Family Memory Book fork: the "Create your family" onboarding screen. Shown by __root.tsx's
// AuthenticatedShell in place of upstream's OnboardingWizard for a non-admin user with no family
// yet -- see onboardingGate.ts and docs/UPSTREAM.md's "Create-family onboarding integration" note.

import { useState, FormEvent } from 'react'
import { Input, Button, Banner } from '@cloudflare/kumo'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { asFamilyOnboardingApi } from './familyOnboardingApi'
import { useDocumentTitle } from './useDocumentTitle'

interface CreateFamilyScreenProps {
  authenticatedApi: RpcStub<AuthenticatedApi>
  onComplete: () => void
}

export default function CreateFamilyScreen({ authenticatedApi, onComplete }: CreateFamilyScreenProps) {
  const [familyName, setFamilyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle('Create your family')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const name = familyName.trim()
    if (!name || loading) return
    setLoading(true)
    setError(null)

    try {
      await asFamilyOnboardingApi(authenticatedApi).createFamily(name)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your family.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-kumo-base px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-semibold text-kumo-default">Create your family</h1>
          <p className="text-sm text-kumo-subtle mt-1">
            Give your family's memory book a name. You can invite others once it's created.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Family name"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            autoFocus
            disabled={loading}
            placeholder="The Lim Family"
          />

          {error && (
            <Banner variant="error" title={error} />
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={!familyName.trim()}
            loading={loading}
            className="w-full justify-center"
          >
            Create family
          </Button>
        </form>
      </div>
    </div>
  )
}
