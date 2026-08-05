import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import type { HouseholdMember } from '../../lib/profile'
import type { Deck, Recipe, RecipePriority, SwipeDirection } from '../../types/recipe'
import { SwipeCard, type SwipeCardHandle } from './SwipeCard'
import { DECKS, DEFAULT_DECK } from './decks'

const VISIBLE_STACK_SIZE = 3

// Sub-recipes (isComponent) and recipes with no method steps at all (a broken
// extraction, not just an incomplete one) don't belong in the swipe deck.
function isDeckEligible(recipe: Recipe): boolean {
  return !recipe.isComponent && recipe.hasSteps
}

// Recipes resurface now (priority changes with repeat exposure, per NewIdeas.txt
// item 10) — a recipe only leaves the pool for good once removedAt is set
// (priority hit 0, or an explicit down-swipe). Never-swiped recipes come first
// so a session favors fresh content; already-swiped-but-not-removed recipes
// fill in once that runs out (irrelevant for a deck like "New" whose own filter
// only ever admits unswiped recipes anyway).
function buildQueue(recipes: Recipe[], priorities: RecipePriority[], deck: Deck): Recipe[] {
  const byId = new Map(priorities.map((p) => [p.recipeId, p]))
  const unseen: Recipe[] = []
  const resurfaced: Recipe[] = []
  for (const recipe of recipes) {
    if (!isDeckEligible(recipe)) continue
    const priority = byId.get(recipe.id)
    if (priority?.removedAt) continue
    if (!deck.isEligible(recipe, priority)) continue
    if (!priority) unseen.push(recipe)
    else resurfaced.push(recipe)
  }
  return [...unseen, ...resurfaced]
}

interface DeckScreenProps {
  currentUser: HouseholdMember
  onSwitchUser: () => void
}

export function DeckScreen({ currentUser, onSwitchUser }: DeckScreenProps) {
  const { recipes, error } = useRecipes()
  // priorities (state) only signals "loaded, safe to build a queue" — the actual
  // data lives in the ref below, kept current on every swipe without forcing a
  // queue rebuild (a rebuild is only wanted on deck switch, not mid-session).
  const [priorities, setPriorities] = useState<RecipePriority[] | null>(null)
  const prioritiesRef = useRef<RecipePriority[]>([])
  const [deck, setDeck] = useState<Deck>(DEFAULT_DECK)
  const [queue, setQueue] = useState<Recipe[]>([])
  // Session progress, not lifetime — a recipe can be swiped many times across
  // sessions now, so "reviewed / total" only makes sense per-session. Resets
  // whenever the deck changes, since that's effectively a new session.
  const [sessionTotal, setSessionTotal] = useState<number | null>(null)
  const topCardRef = useRef<SwipeCardHandle>(null)

  useEffect(() => {
    store.getPriorities(currentUser).then((p) => {
      prioritiesRef.current = p
      setPriorities(p)
    })
  }, [currentUser])

  useEffect(() => {
    if (!recipes || !priorities) return
    const nextQueue = buildQueue(recipes, prioritiesRef.current, deck)
    setQueue(nextQueue)
    setSessionTotal(nextQueue.length)
    // priorities itself is intentionally not re-read here beyond the "loaded"
    // check — see the comment above the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, priorities, deck])

  function handleSwipe(recipeId: string, direction: SwipeDirection) {
    store.applySwipe(currentUser, recipeId, direction, deck.id).then((result) => {
      prioritiesRef.current = [
        ...prioritiesRef.current.filter((p) => p.recipeId !== recipeId),
        result,
      ]
    })
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
        <div className="flex items-center gap-2">
          <span>{currentUser}</span>
          <Link to="/favorites" aria-label="Favorites" className="text-base leading-none">
            ★
          </Link>
          <button
            type="button"
            aria-label="Switch user"
            onClick={onSwitchUser}
            className="text-base leading-none text-white/50"
          >
            ⇄
          </button>
        </div>
        <div className="flex gap-1 rounded-full bg-neutral-900 p-1">
          {DECKS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDeck(d)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                d.id === deck.id ? 'bg-neutral-700 text-white' : 'text-white/50'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span>
          {reviewed} / {sessionTotal}
        </span>
      </div>

      <div className="relative flex-1">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-white/60">
            {deck.id === 'new'
              ? "You've seen everything in this deck — try Everything, or check back once more books are processed."
              : "That's every recipe for now — check back once more books are processed."}
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
