// Not an auth flow — just remembers which of the two household members is
// using this device. No passwords, no accounts, per the brief.

const STORAGE_KEY = 'recipe-app:currentUser'

export const HOUSEHOLD_MEMBERS = ['Cameron', 'Mallorie'] as const
export type HouseholdMember = (typeof HOUSEHOLD_MEMBERS)[number]

export function getCurrentUser(): HouseholdMember | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  return (HOUSEHOLD_MEMBERS as readonly string[]).includes(stored ?? '')
    ? (stored as HouseholdMember)
    : null
}

export function setCurrentUser(user: HouseholdMember) {
  localStorage.setItem(STORAGE_KEY, user)
}

export function clearCurrentUser() {
  localStorage.removeItem(STORAGE_KEY)
}
