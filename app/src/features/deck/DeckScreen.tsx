import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { deckStore } from '../../lib/store/deckStore'
import { ConfirmDialog } from '../../components/ConfirmDialog'
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

// Fisher-Yates. Recipes are stored in book order, so an unshuffled queue would
// mean many cards in a row from the same book (NewIdeas.txt item 13) — shuffle
// each priority group independently so that's mixed up every time a deck is
// (re)loaded, without touching the unseen-before-resurfaced ordering below.
function shuffle<T>(items: T[]): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
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
  return [...shuffle(unseen), ...shuffle(resurfaced)]
}

interface DeckScreenProps {
  currentUser: HouseholdMember
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

export function DeckScreen({ currentUser, onOpenMenu, onViewRecipe }: DeckScreenProps) {
  const { deckId } = useParams<{ deckId: string }>()
  const { recipes, error } = useRecipes()
  const staticDeck = useMemo(() => DECKS.find((d) => d.id === deckId), [deckId])

  // Persisted decks (tag-derived or hand-built in the Catalog deck builder)
  // are a fixed, fetched recipe-id set rather than a live filter — fetched
  // by id whenever deckId doesn't match one of the two static pseudo-decks
  // above. `recipeIds` is kept as a Set so isEligible below stays a stable
  // closure across renders once the fetch resolves.
  const [persistedDeck, setPersistedDeck] = useState<{ label: string; recipeIds: Set<string> } | null>(null)
  const [persistedDeckLoaded, setPersistedDeckLoaded] = useState(false)
  const [deckError, setDeckError] = useState<Error | null>(null)

  useEffect(() => {
    if (staticDeck || !deckId) return
    setPersistedDeckLoaded(false)
    setPersistedDeck(null)
    deckStore
      .getDeck(deckId)
      .then((result) => {
        setPersistedDeck(result ? { label: result.deck.label, recipeIds: new Set(result.recipeIds) } : null)
      })
      .catch((err) => setDeckError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setPersistedDeckLoaded(true))
  }, [deckId, staticDeck])

  // Memoized so the queue-rebuild effect below (which depends on `deck`)
  // doesn't see a "new" deck every render and loop forever re-triggering
  // itself once the persisted fetch resolves.
  const deck: Deck | null = useMemo(() => {
    if (staticDeck) return staticDeck
    if (!deckId) return DEFAULT_DECK
    if (!persistedDeckLoaded) return null
    if (!persistedDeck) return DEFAULT_DECK // stale/unknown deck id — fall back rather than erroring
    return {
      id: deckId,
      label: persistedDeck.label,
      isEligible: (recipe) => persistedDeck.recipeIds.has(recipe.id),
    }
  }, [staticDeck, deckId, persistedDeckLoaded, persistedDeck])

  // priorities (state) only signals "loaded, safe to build a queue" — the actual
  // data lives in the ref below, kept current on every swipe without forcing a
  // queue rebuild (a rebuild is only wanted on deck switch, not mid-session).
  const [priorities, setPriorities] = useState<RecipePriority[] | null>(null)
  const prioritiesRef = useRef<RecipePriority[]>([])
  const [queue, setQueue] = useState<Recipe[]>([])
  // Session progress, not lifetime — a recipe can be swiped many times across
  // sessions now, so "reviewed / total" only makes sense per-session. Resets
  // whenever the deck changes, since that's effectively a new session.
  const [sessionTotal, setSessionTotal] = useState<number | null>(null)
  const topCardRef = useRef<SwipeCardHandle>(null)
  const [confirmingRemove, setConfirmingRemove] = useState<Recipe | null>(null)
  const removeResolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  useEffect(() => {
    store.getPriorities(currentUser).then((p) => {
      prioritiesRef.current = p
      setPriorities(p)
    })
  }, [currentUser])

  useEffect(() => {
    if (!recipes || !priorities || !deck) return
    const nextQueue = buildQueue(recipes, prioritiesRef.current, deck)
    setQueue(nextQueue)
    setSessionTotal(nextQueue.length)
    // priorities itself is intentionally not re-read here beyond the "loaded"
    // check — see the comment above the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, priorities, deck])

  function handleSwipe(recipeId: string, direction: SwipeDirection) {
    if (!deck) return
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

  // A down-swipe sets removedAt, which is sticky and takes the recipe out of
  // every deck's pool for good — unlike left/right it can't be undone by
  // swiping again later, so it gets a confirm step the other directions don't.
  function confirmRemove(recipe: Recipe): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmingRemove(recipe)
      removeResolveRef.current = resolve
    })
  }

  function resolveConfirmRemove(confirmed: boolean) {
    removeResolveRef.current?.(confirmed)
    removeResolveRef.current = null
    setConfirmingRemove(null)
  }

  if (error || deckError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load recipes. Try reloading — if you're offline, this page needs to have
        loaded successfully at least once first.
      </div>
    )
  }

  if (!recipes || !priorities || !deck || sessionTotal === null) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">Loading recipes…</div>
    )
  }

  const visible = queue.slice(0, VISIBLE_STACK_SIZE)
  const reviewed = sessionTotal - queue.length

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-3 flex items-center justify-between text-sm text-white/50">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">{deck.label}</span>
        <span>
          {reviewed} / {sessionTotal}
        </span>
      </div>

      <div className="relative flex-1">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-white/60">
            {deck.id === 'new'
              ? "You've seen everything in this deck — try Everything, or check back once more books are processed."
              : deck.id === 'everything'
                ? "That's every recipe for now — check back once more books are processed."
                : `Nothing tagged "${deck.label}" yet — check back once more books are processed.`}
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
                  onViewDetails={onViewRecipe}
                  confirmRemove={() => confirmRemove(recipe)}
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

      <ConfirmDialog
        isOpen={confirmingRemove !== null}
        title="Remove this recipe?"
        message={
          confirmingRemove
            ? `"${confirmingRemove.title}" won't show up in your decks again.`
            : ''
        }
        confirmLabel="Remove"
        onConfirm={() => resolveConfirmRemove(true)}
        onCancel={() => resolveConfirmRemove(false)}
      />
    </div>
  )
}
