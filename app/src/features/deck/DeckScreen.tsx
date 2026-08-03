import { useEffect, useMemo, useRef, useState } from 'react'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import type { HouseholdMember } from '../../lib/profile'
import type { Recipe, Swipe, SwipeDirection } from '../../types/recipe'
import { SwipeCard, type SwipeCardHandle } from './SwipeCard'

const VISIBLE_STACK_SIZE = 3

interface DeckScreenProps {
  currentUser: HouseholdMember
}

export function DeckScreen({ currentUser }: DeckScreenProps) {
  const { recipes, error } = useRecipes()
  const [priorSwipes, setPriorSwipes] = useState<Swipe[] | null>(null)
  const [queue, setQueue] = useState<Recipe[]>([])
  const topCardRef = useRef<SwipeCardHandle>(null)

  useEffect(() => {
    store.getSwipesForUser(currentUser).then(setPriorSwipes)
  }, [currentUser])

  useEffect(() => {
    if (!recipes || !priorSwipes) return
    const alreadySwiped = new Set(priorSwipes.map((s) => s.recipeId))
    setQueue(recipes.filter((r) => !r.isComponent && !alreadySwiped.has(r.id)))
  }, [recipes, priorSwipes])

  const total = useMemo(() => recipes?.filter((r) => !r.isComponent).length ?? 0, [recipes])

  function handleSwipe(direction: SwipeDirection) {
    const top = queue[0]
    if (!top) return
    store.recordSwipe(currentUser, top.id, direction)
    setQueue((q) => q.slice(1))
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load recipes. Try reloading — if you're offline, this page needs to have
        loaded successfully at least once first.
      </div>
    )
  }

  if (!recipes || !priorSwipes) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">Loading recipes…</div>
    )
  }

  const visible = queue.slice(0, VISIBLE_STACK_SIZE)
  const reviewed = total - queue.length

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between text-sm text-white/50">
        <span>{currentUser}</span>
        <span>
          {reviewed} / {total}
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
        <div className="mt-4 flex justify-center gap-6">
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
