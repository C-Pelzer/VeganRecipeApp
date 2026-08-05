import { useEffect, useRef, useState } from 'react'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import type { HouseholdMember } from '../../lib/profile'
import type { Recipe, RecipePriority, SwipeDirection } from '../../types/recipe'
import { SwipeCard, type SwipeCardHandle } from './SwipeCard'

const VISIBLE_STACK_SIZE = 3

// Deck variety (item 2) lands in a later pass — for now everyone gets the same
// pool, tagged with a fixed deck id so swipe_events already carries the field
// deck filtering will need.
const DEFAULT_DECK_ID = 'everything'

// Sub-recipes (isComponent) and recipes with no method steps at all (a broken
// extraction, not just an incomplete one) don't belong in the swipe deck.
function isDeckEligible(recipe: Recipe): boolean {
  return !recipe.isComponent && recipe.hasSteps
}

// Recipes resurface now (priority changes with repeat exposure, per NewIdeas.txt
// item 10) — a recipe only leaves the pool for good once removedAt is set
// (priority hit 0, or an explicit down-swipe). Never-swiped recipes come first
// so a session favors fresh content; already-swiped-but-not-removed recipes
// fill in once that runs out.
function buildQueue(recipes: Recipe[], priorities: RecipePriority[]): Recipe[] {
  const byId = new Map(priorities.map((p) => [p.recipeId, p]))
  const unseen: Recipe[] = []
  const resurfaced: Recipe[] = []
  for (const recipe of recipes) {
    if (!isDeckEligible(recipe)) continue
    const priority = byId.get(recipe.id)
    if (!priority) {
      unseen.push(recipe)
      continue
    }
    if (priority.removedAt) continue
    resurfaced.push(recipe)
  }
  return [...unseen, ...resurfaced]
}

interface DeckScreenProps {
  currentUser: HouseholdMember
}

export function DeckScreen({ currentUser }: DeckScreenProps) {
  const { recipes, error } = useRecipes()
  const [priorities, setPriorities] = useState<RecipePriority[] | null>(null)
  const [queue, setQueue] = useState<Recipe[]>([])
  // Session progress, not lifetime — a recipe can be swiped many times across
  // sessions now, so "reviewed / total" only makes sense per-session.
  const [sessionTotal, setSessionTotal] = useState<number | null>(null)
  const topCardRef = useRef<SwipeCardHandle>(null)

  useEffect(() => {
    store.getPriorities(currentUser).then(setPriorities)
  }, [currentUser])

  useEffect(() => {
    if (!recipes || !priorities) return
    const nextQueue = buildQueue(recipes, priorities)
    setQueue(nextQueue)
    setSessionTotal((prev) => prev ?? nextQueue.length)
  }, [recipes, priorities])

  function handleSwipe(recipeId: string, direction: SwipeDirection) {
    store.applySwipe(currentUser, recipeId, direction, DEFAULT_DECK_ID)
    // Filter by id rather than slicing the front — correct even if this fires
    // out of order relative to the queue's current state.
    setQueue((q) => q.filter((r) => r.id !== recipeId))
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load recipes. Try reloading — if you're offline, this page needs to have
        loaded successfully at least once first.
      </div>
    )
  }

  if (!recipes || !priorities || sessionTotal === null) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">Loading recipes…</div>
    )
  }

  const visible = queue.slice(0, VISIBLE_STACK_SIZE)
  const reviewed = sessionTotal - queue.length

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between text-sm text-white/50">
        <span>{currentUser}</span>
        <span>
          {reviewed} / {sessionTotal}
        </span>
      </div>

      <div className="relative flex-1">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-white/60">
            That's every recipe for now — check back once more books are processed.
          </div>
        ) : (
          visible
            .slice()
            .reverse()
            .map((recipe, reversedIndex) => {
              const stackDepth = visible.length - 1 - reversedIndex
              const isTop = stackDepth === 0
              return (
                <SwipeCard
                  key={recipe.id}
                  ref={isTop ? topCardRef : undefined}
                  recipe={recipe}
                  isTop={isTop}
                  stackDepth={stackDepth}
                  onSwipe={handleSwipe}
                />
              )
            })
        )}
      </div>

      {visible.length > 0 && (
        <div className="mt-4 flex items-center justify-center gap-6">
          <button
            type="button"
            aria-label="Pass"
            onClick={() => topCardRef.current?.triggerSwipe('left')}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-2xl text-rose-500 shadow-lg active:scale-95"
          >
            ✕
          </button>
          <button
            type="button"
            aria-label="Remove"
            onClick={() => topCardRef.current?.triggerSwipe('down')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 text-base text-neutral-400 shadow-lg active:scale-95"
          >
            🗑
          </button>
          <button
            type="button"
            aria-label="Yum"
            onClick={() => topCardRef.current?.triggerSwipe('right')}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-800 text-2xl text-emerald-400 shadow-lg active:scale-95"
          >
            ♥
          </button>
        </div>
      )}
    </div>
  )
}
