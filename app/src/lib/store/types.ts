import type { Swipe, SwipeDirection } from '../../types/recipe'

/**
 * Everything that needs to sync between the two phones goes through this
 * interface. `LocalStore` (localStorage-backed) is the only implementation
 * today; a Supabase-backed implementation can replace it later without any
 * UI changes, since match detection needs both users' swipes in one place
 * and this device can only see its own for now.
 */
export interface SyncStore {
  getSwipesForUser(userId: string): Promise<Swipe[]>
  getAllSwipes(): Promise<Swipe[]>
  recordSwipe(userId: string, recipeId: string, direction: SwipeDirection): Promise<Swipe>
}
