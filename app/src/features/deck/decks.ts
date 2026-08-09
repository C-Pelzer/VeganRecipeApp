import type { Deck } from '../../types/recipe'

// The only two decks that stay live filters rather than persisted rows —
// "unswiped" and "everything" aren't a fixed set of 40, they're the whole
// pool by definition. Tag-derived and hand-built decks are now persisted
// swipe_decks rows (app/src/lib/store/deckStore.ts), looked up by DeckScreen
// when a deckId doesn't match one of these two.
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
