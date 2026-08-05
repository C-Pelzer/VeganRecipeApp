import type { RecipePriority, SwipeDirection } from '../../types/recipe'

/**
 * Everything that needs to sync between the two phones goes through this
 * interface. Favorites and shared-favorites aren't separate store methods —
 * they're derived client-side from getPriorities() for each household member,
 * same as deck-eligibility filtering already lives in DeckScreen rather than
 * the store.
 */
export interface SyncStore {
  getPriorities(userId: string): Promise<RecipePriority[]>
  applySwipe(
    userId: string,
    recipeId: string,
    direction: SwipeDirection,
    deckId: string,
  ): Promise<RecipePriority>
}
