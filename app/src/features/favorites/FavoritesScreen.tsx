import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { favoritedRecipeIds, sharedFavoriteIds } from '../../lib/favorites'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
import type { Recipe, RecipePriority } from '../../types/recipe'

type Tab = 'yours' | 'shared'

interface FavoritesScreenProps {
  currentUser: HouseholdMember
}

export function FavoritesScreen({ currentUser }: FavoritesScreenProps) {
  const { recipes, error } = useRecipes()
  const [prioritiesByUser, setPrioritiesByUser] = useState<Record<
    HouseholdMember,
    RecipePriority[]
  > | null>(null)
  const [tab, setTab] = useState<Tab>('yours')

  useEffect(() => {
    Promise.all(HOUSEHOLD_MEMBERS.map((user) => store.getPriorities(user))).then((results) => {
      const byUser = {} as Record<HouseholdMember, RecipePriority[]>
      HOUSEHOLD_MEMBERS.forEach((user, i) => {
        byUser[user] = results[i]
      })
      setPrioritiesByUser(byUser)
    })
  }, [])

  const favoriteIds = useMemo(() => {
    if (!prioritiesByUser) return new Set<string>()
    if (tab === 'yours') return favoritedRecipeIds(prioritiesByUser[currentUser] ?? [])
    const [a, b] = HOUSEHOLD_MEMBERS.map((user) => favoritedRecipeIds(prioritiesByUser[user] ?? []))
    return sharedFavoriteIds(a, b)
  }, [prioritiesByUser, tab, currentUser])

  const favoriteRecipes = useMemo<Recipe[]>(() => {
    if (!recipes) return []
    return recipes.filter((r) => favoriteIds.has(r.id))
  }, [recipes, favoriteIds])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load recipes.
      </div>
    )
  }

  if (!recipes || !prioritiesByUser) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        Loading favorites…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between text-sm">
        <Link to="/" className="text-white/50">
          ← Deck
        </Link>
        <div className="flex gap-1 rounded-full bg-neutral-900 p-1">
          <button
            type="button"
            onClick={() => setTab('yours')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'yours' ? 'bg-neutral-700 text-white' : 'text-white/50'
            }`}
          >
            Yours
          </button>
          <button
            type="button"
            onClick={() => setTab('shared')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'shared' ? 'bg-neutral-700 text-white' : 'text-white/50'
            }`}
          >
            Shared
          </button>
        </div>
        <span className="text-white/50">{favoriteRecipes.length}</span>
      </div>

      {favoriteRecipes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-white/60">
          {tab === 'yours'
            ? "Nothing favorited yet — swipe right on something good."
            : "Nothing you've both favorited yet."}
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto">
          {favoriteRecipes.map((recipe) => (
            <div key={recipe.id} className="flex gap-3 rounded-2xl bg-neutral-900 p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                {recipe.image ? (
                  <img src={recipe.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl">🌱</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs uppercase tracking-wide text-white/50">
                  {recipe.source_book}
                </p>
                <p className="truncate font-medium text-white">{recipe.title}</p>
                <p className="text-xs text-white/50">{recipe.ingredient_count} ingredients</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
