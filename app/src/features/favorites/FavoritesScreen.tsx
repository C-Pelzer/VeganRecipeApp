import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { shoppingListStore } from '../../lib/store/shoppingListStore'
import { mealPlanStore } from '../../lib/store/mealPlanStore'
import { favoritedRecipeIds, sharedFavoriteIds } from '../../lib/favorites'
 import { effectiveTagsByRecipe, useRecipeTagOverrides, useRecipeTags } from '../../lib/tags'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
import type { Recipe, RecipePriority, TagCategory } from '../../types/recipe'

type Tab = 'yours' | 'shared'
type SortKey = 'recent' | 'shared-first' | 'title'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'shared-first', label: 'Shared first' },
  { key: 'title', label: 'A–Z' },
]

// The flat list was in bundle order — effectively the order the books were
// processed in — so the thing you swiped right on a minute ago could sit 130
// rows down. These are the categories worth filtering a favorites list by:
// what kind of meal it is, how long it takes, and how much effort it is.
// Cuisine and book are deliberately left out; they make better decks than
// filters, and the chip row has to stay scannable.
const FILTER_CATEGORIES: TagCategory[] = ['course', 'time', 'effort']
const MAX_CHIPS = 12

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
  const [sort, setSort] = useState<SortKey>('recent')
  const [activeChips, setActiveChips] = useState<Set<string>>(new Set())
  const { tags } = useRecipeTags()
  const { overrides } = useRecipeTagOverrides()

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
    ])
      .then(() => {
        setSelectedIds(new Set())
        navigate('/shopping-list')
      })
      // The button is disabled while this runs, so a rejection without this
      // left it stuck disabled with no way to retry.
      .catch(() => setAddingToList(false))
  }

  useEffect(() => {
    Promise.all(HOUSEHOLD_MEMBERS.map((user) => store.getPriorities(user)))
      .then((results) => {
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

  const tagsByRecipe = useMemo(
    () => effectiveTagsByRecipe(tags ?? [], overrides ?? []),
    [tags, overrides],
  )

  const matchingRecipes = useMemo<Recipe[]>(() => {
    if (!recipes) return []
    const base = recipes.filter((r) => favoriteIds.has(r.id))
    if (activeChips.size === 0) return base
    // Every selected chip must match, so stacking chips narrows rather than
    // widens — picking "Dessert" then "15 min or less" means both.
    return base.filter((recipe) => {
      const slugs = new Set((tagsByRecipe.get(recipe.id) ?? []).map((t) => `${t.category}::${t.tagSlug}`))
      return [...activeChips].every((chip) => slugs.has(chip))
    })
  }, [recipes, favoriteIds, activeChips, tagsByRecipe])

  // Chips are drawn from the favorites themselves rather than the whole tag
  // vocabulary, so there's never a chip that filters down to nothing.
  const chips = useMemo(() => {
    if (!recipes) return []
    const counts = new Map<string, { key: string; label: string; count: number }>()
    for (const recipe of recipes) {
      if (!favoriteIds.has(recipe.id)) continue
      for (const tag of tagsByRecipe.get(recipe.id) ?? []) {
        if (!FILTER_CATEGORIES.includes(tag.category)) continue
        const key = `${tag.category}::${tag.tagSlug}`
        const existing = counts.get(key)
        if (existing) existing.count += 1
        else counts.set(key, { key, label: tag.label, count: 1 })
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, MAX_CHIPS)
  }, [recipes, favoriteIds, tagsByRecipe])

  const favoriteRecipes = useMemo<Recipe[]>(() => {
    const sorted = [...matchingRecipes]
    if (sort === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      return sorted
    }

    // updatedAt is when the recipe was last swiped, which for a favorite is
    // when it was favorited (or re-liked) — the closest thing to "recently
    // added" without a column for it.
    const swipedAt = new Map((prioritiesByUser?.[currentUser] ?? []).map((p) => [p.recipeId, p.updatedAt]))
    const byRecent = (a: Recipe, b: Recipe) => (swipedAt.get(b.id) ?? '').localeCompare(swipedAt.get(a.id) ?? '')

    if (sort === 'shared-first') {
      const bothIds = prioritiesByUser
        ? sharedFavoriteIds(
            ...(HOUSEHOLD_MEMBERS.map((user) => favoritedRecipeIds(prioritiesByUser[user] ?? [])) as [
              Set<string>,
              Set<string>,
            ]),
          )
        : new Set<string>()
      sorted.sort((a, b) => {
        const diff = Number(bothIds.has(b.id)) - Number(bothIds.has(a.id))
        return diff !== 0 ? diff : byRecent(a, b)
      })
      return sorted
    }

    sorted.sort(byRecent)
    return sorted
  }, [matchingRecipes, sort, prioritiesByUser, currentUser])

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
    <div className="relative flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-base leading-none text-white/50"
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

      <div className="mb-3 flex gap-1 rounded-xl bg-neutral-900 p-1">
        {SORTS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={sort === option.key}
            onClick={() => setSort(option.key)}
            className={`min-h-11 flex-1 rounded-lg px-2 text-xs transition-colors ${
              sort === option.key ? 'bg-neutral-800 font-semibold text-white' : 'text-white/50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {activeChips.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveChips(new Set())}
              className="min-h-9 shrink-0 rounded-full border border-neutral-700 px-3 text-xs text-white/70"
            >
              Clear
            </button>
          )}
          {chips.map((chip) => {
            const on = activeChips.has(chip.key)
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setActiveChips((current) => {
                    const next = new Set(current)
                    if (next.has(chip.key)) next.delete(chip.key)
                    else next.add(chip.key)
                    return next
                  })
                }
                className={`min-h-9 shrink-0 rounded-full px-3 text-xs transition-colors ${
                  on ? 'bg-emerald-500 font-semibold text-neutral-950' : 'bg-neutral-900 text-white/70'
                }`}
              >
                {chip.label}
                <span className={on ? 'ml-1 text-neutral-950/60' : 'ml-1 text-white/40'}>{chip.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {favoriteRecipes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-white/60">
          {activeChips.size > 0 ? (
            <>
              {/* Distinguishes "you have no favorites" from "your filters
                  matched none of them", which are very different problems. */}
              <p>No favorites match those filters.</p>
              <button
                type="button"
                onClick={() => setActiveChips(new Set())}
                className="min-h-11 rounded-full bg-neutral-800 px-4 text-sm font-medium text-white"
              >
                Clear filters
              </button>
            </>
          ) : (
            <p>
              {tab === 'yours'
                ? 'Nothing favorited yet — swipe right on something good.'
                : "Nothing you've both favorited yet."}
            </p>
          )}
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
          className="absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 shadow-lg disabled:opacity-60"
        >
          {addingToList ? 'Adding…' : `Add ${selectedIds.size} to Shopping List`}
        </button>
      )}
    </div>
  )
}
