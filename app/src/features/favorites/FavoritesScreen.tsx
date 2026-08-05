import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { shoppingListStore } from '../../lib/store/shoppingListStore'
import { mealPlanStore } from '../../lib/store/mealPlanStore'
import { favoritedRecipeIds, sharedFavoriteIds } from '../../lib/favorites'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
import type { Recipe, RecipePriority } from '../../types/recipe'

type Tab = 'yours' | 'shared'

interface FavoritesScreenProps {
  currentUser: HouseholdMember
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

export function FavoritesScreen({ currentUser, onOpenMenu, onViewRecipe }: FavoritesScreenProps) {
  const navigate = useNavigate()
  const { recipes, error } = useRecipes()
  const [prioritiesByUser, setPrioritiesByUser] = useState<Record<
    HouseholdMember,
    RecipePriority[]
  > | null>(null)
  const [tab, setTab] = useState<Tab>('yours')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [addingToList, setAddingToList] = useState(false)

  function switchTab(nextTab: Tab) {
    setTab(nextTab)
    setSelectedIds(new Set())
  }

  function toggleSelected(recipeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(recipeId)) next.delete(recipeId)
      else next.add(recipeId)
      return next
    })
  }

  function handleAddToShoppingList() {
    const selectedRecipes = favoriteRecipes.filter((r) => selectedIds.has(r.id))
    if (selectedRecipes.length === 0) return
    setAddingToList(true)
    Promise.all([
      shoppingListStore.addRecipes(selectedRecipes),
      mealPlanStore.addRecipes(selectedRecipes.map((r) => r.id)),
    ]).then(() => {
      setSelectedIds(new Set())
      navigate('/shopping-list')
    })
  }

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
    <div className="relative flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="text-base leading-none text-white/50"
        >
          ☰
        </button>
        <div className="flex gap-1 rounded-full bg-neutral-900 p-1">
          <button
            type="button"
            onClick={() => switchTab('yours')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === 'yours' ? 'bg-neutral-700 text-white' : 'text-white/50'
            }`}
          >
            Yours
          </button>
          <button
            type="button"
            onClick={() => switchTab('shared')}
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
        <div className="flex-1 space-y-3 overflow-y-auto pb-16">
          {favoriteRecipes.map((recipe) => (
            <div key={recipe.id} className="flex items-center gap-3 rounded-2xl bg-neutral-900 p-3">
              <input
                type="checkbox"
                aria-label={`Select ${recipe.title}`}
                checked={selectedIds.has(recipe.id)}
                onChange={() => toggleSelected(recipe.id)}
                className="h-5 w-5 shrink-0 accent-emerald-500"
              />
              <button
                type="button"
                onClick={() => onViewRecipe(recipe.id)}
                className="flex min-w-0 flex-1 gap-3 text-left"
              >
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
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && (
        <button
          type="button"
          onClick={handleAddToShoppingList}
          disabled={addingToList}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 shadow-lg disabled:opacity-60"
        >
          {addingToList ? 'Adding…' : `Add ${selectedIds.size} to Shopping List`}
        </button>
      )}
    </div>
  )
}
