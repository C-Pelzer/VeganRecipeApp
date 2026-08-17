import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Profile } from '../../lib/auth'
import type { MealCalendarEntry, MealType, Recipe } from '../../types/recipe'

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

interface MealSlotPickerProps {
  isOpen: boolean
  date: Date
  mealType: MealType
  members: Profile[]
  /** Shown first, its own section — recipes already on the meal plan. */
  plannedRecipes: Recipe[]
  /** Shown after Meal Plan — every other favorite (caller excludes anything already in plannedRecipes). */
  favoriteRecipes: Recipe[]
  initialEntry: MealCalendarEntry | null
  onSave: (recipeId: string, assignedTo: string) => void
  onClear: () => void
  onClose: () => void
  onViewRecipe: (recipeId: string) => void
}

export function MealSlotPicker({
  isOpen,
  date,
  mealType,
  members,
  plannedRecipes,
  favoriteRecipes,
  initialEntry,
  onSave,
  onClear,
  onClose,
  onViewRecipe,
}: MealSlotPickerProps) {
  const [search, setSearch] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [assignedTo, setAssignedTo] = useState<string>(members[0]?.id ?? '')

  useEffect(() => {
    if (isOpen) {
      setSelectedRecipeId(initialEntry?.recipeId ?? null)
      setAssignedTo(initialEntry?.assignedTo ?? members[0]?.id ?? '')
      setSearch('')
    }
  }, [isOpen, initialEntry, members])

  function matchesSearch(recipe: Recipe): boolean {
    const query = search.trim().toLowerCase()
    return !query || recipe.title.toLowerCase().includes(query)
  }

  const visiblePlanned = plannedRecipes.filter(matchesSearch)
  const visibleFavorites = favoriteRecipes.filter(matchesSearch)
  const hasAnyRecipes = plannedRecipes.length > 0 || favoriteRecipes.length > 0

  function renderRecipeButton(recipe: Recipe) {
    return (
      <button
        key={recipe.id}
        type="button"
        onClick={() => setSelectedRecipeId(recipe.id)}
        className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors ${
          selectedRecipeId === recipe.id ? 'bg-emerald-500/20 ring-1 ring-emerald-500' : 'bg-neutral-800'
        }`}
      >
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-neutral-700">
          {recipe.image ? (
            <img src={recipe.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl">🌱</div>
          )}
        </div>
        <p className="min-w-0 flex-1 truncate font-medium">{recipe.title}</p>
      </button>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60"
          />
          <motion.div
            key="panel"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl bg-neutral-900 text-white"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">
                  {MEAL_TYPE_LABELS[mealType]}
                </p>
                <p className="font-medium">
                  {date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {initialEntry && (
                  <button
                    type="button"
                    onClick={() => onViewRecipe(initialEntry.recipeId)}
                    className="text-sm font-medium text-emerald-400"
                  >
                    View recipe
                  </button>
                )}
                <button type="button" onClick={onClose} className="text-base leading-none text-white/50">
                  ✕
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 p-4">
              <div className="flex gap-1 rounded-full bg-neutral-800 p-1">
                {members.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setAssignedTo(member.id)}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      assignedTo === member.id ? 'bg-emerald-500 text-neutral-950' : 'text-white/60'
                    }`}
                  >
                    {member.displayName || member.email}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Search favorites…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-xl bg-neutral-800 px-3 py-2 text-base placeholder:text-white/40 focus:outline-none"
              />
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
              {visiblePlanned.length === 0 && visibleFavorites.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/50">
                  {hasAnyRecipes ? 'No matches.' : 'No favorites yet — swipe right on something first.'}
                </p>
              ) : (
                <>
                  {visiblePlanned.length > 0 && (
                    <>
                      <p className="px-1 text-xs font-medium uppercase tracking-wide text-white/40">Meal Plan</p>
                      {visiblePlanned.map(renderRecipeButton)}
                    </>
                  )}
                  {visibleFavorites.length > 0 && (
                    <>
                      <p className="px-1 text-xs font-medium uppercase tracking-wide text-white/40">Favorites</p>
                      {visibleFavorites.map(renderRecipeButton)}
                    </>
                  )}
                </>
              )}
            </div>

            <div className="flex gap-2 border-t border-white/10 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {initialEntry && (
                <button
                  type="button"
                  onClick={onClear}
                  className="rounded-full px-4 py-2 text-sm font-medium text-rose-400"
                >
                  Clear slot
                </button>
              )}
              <button
                type="button"
                disabled={!selectedRecipeId}
                onClick={() => selectedRecipeId && onSave(selectedRecipeId, assignedTo)}
                className="ml-auto rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
