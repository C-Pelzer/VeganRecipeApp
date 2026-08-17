import { useState } from 'react'
import { useAuth } from '../../lib/auth'

export function SignInScreen() {
  const { signInWithGoogle } = useAuth()
  const [pending, setPending] = useState(false)

  async function handleSignIn() {
    setPending(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      console.warn('Google sign-in failed', err)
      setPending(false)
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-white">Vegan Recipes</h1>
        <p className="mt-1 text-white/50">Sign in to see your household's decks, favorites, and shopping list.</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-4">
        <button
          type="button"
          onClick={handleSignIn}
          disabled={pending}
          className="flex items-center justify-center gap-3 rounded-2xl bg-white py-4 text-lg font-medium text-neutral-900 shadow-lg active:scale-95 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3a7.4 7.4 0 0 1-11-3.87H1.05v3.1A12 12 0 0 0 12 24z"
            />
            <path fill="#FBBC05" d="M5.04 14.22a7.2 7.2 0 0 1 0-4.44v-3.1H1.05a12 12 0 0 0 0 10.64z" />
            <path
              fill="#EA4335"
              d="M12 4.75c1.76 0 3.35.6 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.05 6.68l3.99 3.1A7.16 7.16 0 0 1 12 4.75z"
            />
          </svg>
          {pending ? 'Signing in…' : 'Sign in with Google'}
        </button>
      </div>
    </div>
  )
}
