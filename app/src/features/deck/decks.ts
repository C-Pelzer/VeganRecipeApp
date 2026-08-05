import type { Deck } from '../../types/recipe'

// More deck types (cuisine, cook-time, ingredient — NewIdeas.txt item 2) land once
// the underlying data supports them; see the plan for why those aren't here yet.
export const DECKS: Deck[] = [
  {
    id: 'new',
    label: 'New',
    isEligible: (_recipe, priority) => !priority,
  },
  {
    id: 'everything',
    label: 'Everything',
    isEligible: () => true,
  },
]

export const DEFAULT_DECK = DECKS[1]

/** Builds a Deck for a tag from the recipe_tags table (see app/src/lib/tags.ts). */
export function tagDeck(tag: { slug: string; label: string }): Deck {
  return {
    id: tag.slug,
    label: tag.label,
    isEligible: (_recipe, _priority, tagSlugs) => tagSlugs.has(tag.slug),
  }
}
