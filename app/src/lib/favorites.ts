import type { RecipePriority } from '../types/recipe'

/** A recipe is favorited once right-swiped, and stays favorited even if later
 * left-swipes drop its priority — removal (removedAt) is the only thing that
 * takes it back out. */
export function favoritedRecipeIds(priorities: RecipePriority[]): Set<string> {
  return new Set(
    priorities.filter((p) => p.favorited && !p.removedAt).map((p) => p.recipeId),
  )
}

/** NewIdeas.txt item 8: "the group favorites list is the inner join" — live,
 * not persisted, so it tracks both people's current favorites exactly. */
export function sharedFavoriteIds(a: Set<string>, b: Set<string>): Set<string> {
  const shared = new Set<string>()
  for (const id of a) {
    if (b.has(id)) shared.add(id)
  }
  return shared
}
