import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export interface Profile {
  id: string
  email: string
  displayName: string
  avatarUrl: string
  householdId: string | null
}

export interface Household {
  id: string
  name: string
  inviteCode: string
}

interface ProfileRow {
  id: string
  email: string
  display_name: string
  avatar_url: string
  household_id: string | null
}

interface HouseholdRow {
  id: string
  name: string
  invite_code: string
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    householdId: row.household_id,
  }
}

function rowToHousehold(row: HouseholdRow): Household {
  return { id: row.id, name: row.name, inviteCode: row.invite_code }
}

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  household: Household | null
}

const AuthContext = createContext<
  (AuthState & {
    signInWithGoogle: () => Promise<void>
    signOut: () => Promise<void>
    createHousehold: (name: string) => Promise<void>
    joinHousehold: (inviteCode: string) => Promise<void>
    refreshProfile: () => Promise<void>
  }) | null
>(null)

// Store modules aren't React components and can't call useAuth(), but every
// insert that writes a household_id needs one — this mirrors the existing
// single-instance `supabase` client convention (supabaseClient.ts) rather
// than threading household id through every store function's signature.
let ambientProfile: Profile | null = null
let ambientHousehold: Household | null = null

export function getCurrentProfile(): Profile | null {
  return ambientProfile
}

export function getCurrentHouseholdId(): string {
  if (!ambientHousehold) throw new Error('No household loaded yet — this should never be called before sign-in.')
  return ambientHousehold.id
}

/** Every profile in a household (including the caller) — households can have any number of members now. */
export async function listHouseholdMembers(householdId: string): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').eq('household_id', householdId)
  if (error) throw error
  return (data as ProfileRow[]).map(rowToProfile)
}

async function fetchProfileAndHousehold(userId: string): Promise<{ profile: Profile; household: Household | null }> {
  const { data: profileRow, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  const profile = rowToProfile(profileRow as ProfileRow)

  let household: Household | null = null
  if (profile.householdId) {
    const { data: householdRow, error: householdError } = await supabase
      .from('households')
      .select('*')
      .eq('id', profile.householdId)
      .single()
    if (householdError) throw householdError
    household = rowToHousehold(householdRow as HouseholdRow)
  }

  return { profile, household }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    session: null,
    profile: null,
    household: null,
  })

  async function loadForSession(session: Session | null) {
    if (!session) {
      ambientProfile = null
      ambientHousehold = null
      setState({ loading: false, session: null, profile: null, household: null })
      return
    }
    try {
      const { profile, household } = await fetchProfileAndHousehold(session.user.id)
      ambientProfile = profile
      ambientHousehold = household
      setState({ loading: false, session, profile, household })
    } catch (err) {
      console.warn('Failed to load profile/household', err)
      ambientProfile = null
      ambientHousehold = null
      setState({ loading: false, session, profile: null, household: null })
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => loadForSession(data.session))

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      loadForSession(session)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function createHousehold(name: string) {
    const { error } = await supabase.rpc('create_household', { p_name: name })
    if (error) throw error
    if (state.session) await loadForSession(state.session)
  }

  async function joinHousehold(inviteCode: string) {
    const { error } = await supabase.rpc('join_household', { p_invite_code: inviteCode })
    if (error) throw error
    if (state.session) await loadForSession(state.session)
  }

  async function refreshProfile() {
    if (state.session) await loadForSession(state.session)
  }

  return (
    <AuthContext.Provider
      value={{ ...state, signInWithGoogle, signOut, createHousehold, joinHousehold, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
