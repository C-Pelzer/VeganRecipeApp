import { useEffect, useMemo, useState } from 'react'
import { SegmentedTabs } from '../../components/SegmentedTabs'
import { PLAN_SEGMENTS } from '../../components/segments'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useRecipes } from '../../lib/data'
import { mealPlanStore } from '../../lib/store/mealPlanStore'
import type { MealPlanEntry, Recipe } from '../../types/recipe'

interface MealPlanScreenProps {
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

export function MealPlanScreen({ onOpenMenu, onViewRecipe }: MealPlanScreenProps) {
  const { recipes, error } = useRecipes()
  const [entries, setEntries] = useState<MealPlanEntry[] | null>(null)
  const [entriesError, setEntriesError] = useState<Error | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    mealPlanStore
      .getEntries()
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch((err) => {
        if (!cancelled) setEntriesError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const plannedRecipes = useMemo<Recipe[]>(() => {
    if (!recipes || !entries) return []
    const ids = new Set(entries.map((e) => e.recipeId))
    return recipes.filter((r) => ids.has(r.id))
  }, [recipes, entries])

  function handleRemove(recipe: Recipe) {
    setRemovingId(recipe.id)
    mealPlanStore.removeRecipe(recipe).then(() => {
      setEntries((current) => current?.filter((e) => e.recipeId !== recipe.id) ?? current)
      setRemovingId(null)
    })
  }

  function handleClear() {
    setConfirmingClear(false)
    mealPlanStore.clearAll().then(() => setEntries([]))
  }

  if (error || entriesError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load the meal plan. Try reloading.
      </div>
    )
  }

  if (!recipes || !entries) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        Loading meal plan…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Meal Plan</span>
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          disabled={plannedRecipes.length === 0}
          className="text-sm font-medium text-rose-400 disabled:text-white/20"
        >
          Clear
        </button>
      </div>

      <SegmentedTabs segments={PLAN_SEGMENTS} activeTo="/meal-plan" />

      {plannedRecipes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-white/60">
          Nothing planned yet — add recipes from Favorites.
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {plannedRecipes.map((recipe) => (
            <div key={recipe.id} className="flex items-center gap-3 rounded-2xl bg-neutral-900 p-3">
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
              <button
                type="button"
                aria-label={`Remove ${recipe.title}`}
                onClick={() => handleRemove(recipe)}
                disabled={removingId === recipe.id}
                className="shrink-0 text-base leading-none text-white/40 disabled:opacity-40"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingClear}
        title="Clear meal plan?"
        message={`This removes all ${plannedRecipes.length} planned recipe${plannedRecipes.length === 1 ? '' : 's'}. The shopping list is not affected.`}
        confirmLabel="Clear"
        onConfirm={handleClear}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  )
}
