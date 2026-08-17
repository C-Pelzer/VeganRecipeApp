import { useState } from 'react'
import { useAuth } from '../../lib/auth'

type Mode = 'choose' | 'create' | 'join'

export function HouseholdOnboardingScreen() {
  const { createHousehold, joinHousehold, signOut } = useAuth()
  const [mode, setMode] = useState<Mode>('choose')
  const [name, setName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    setPending(true)
    setError(null)
    try {
      await createHousehold(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create household')
      setPending(false)
    }
  }

  async function handleJoin() {
    setPending(true)
    setError(null)
    try {
      await joinHousehold(inviteCode.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join household')
      setPending(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-white">One more step</h1>
        <p className="mt-1 text-white/50">Create a household, or join one you've been invited to.</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4">
        {mode === 'choose' && (
          <>
            <button
              type="button"
              onClick={() => setMode('create')}
              className="rounded-2xl bg-neutral-800 py-4 text-lg font-medium text-white shadow-lg active:scale-95"
            >
              Create a household
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="rounded-2xl bg-neutral-800 py-4 text-lg font-medium text-white shadow-lg active:scale-95"
            >
              Join with an invite code
            </button>
          </>
        )}

        {mode === 'create' && (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Household name"
              className="rounded-2xl bg-neutral-800 px-4 py-4 text-lg text-white placeholder:text-white/40"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={pending}
              className="rounded-2xl bg-white py-4 text-lg font-medium text-neutral-900 shadow-lg active:scale-95 disabled:opacity-60"
            >
              {pending ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setMode('choose')} className="text-white/50">
              Back
            </button>
          </>
        )}

        {mode === 'join' && (
          <>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Invite code"
              className="rounded-2xl bg-neutral-800 px-4 py-4 text-lg text-white placeholder:text-white/40"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={pending || !inviteCode.trim()}
              className="rounded-2xl bg-white py-4 text-lg font-medium text-neutral-900 shadow-lg active:scale-95 disabled:opacity-60"
            >
              {pending ? 'Joining…' : 'Join'}
            </button>
            <button type="button" onClick={() => setMode('choose')} className="text-white/50">
              Back
            </button>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="button" onClick={() => void signOut()} className="mt-4 text-sm text-white/40">
          Sign out
        </button>
      </div>
    </div>
  )
}
