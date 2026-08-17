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
 * not persisted, so it tracks every current household member's favorites
 * exactly. A household of one has nothing to intersect against, so that case
 * just returns their own favorites rather than an empty set. */
export function sharedFavoriteIds(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set()
  const [first, ...rest] = sets
  const shared = new Set<string>()
  for (const id of first) {
    if (rest.every((s) => s.has(id))) shared.add(id)
  }
  return shared
}

/** Any household member's favorite counts — used where the picker should offer
 * the whole household's pool (e.g. the meal calendar), not just one person's. */
export function unionFavoriteIds(sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((s) => [...s]))
}
