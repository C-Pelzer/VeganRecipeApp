import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
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
  recipes: Recipe[]
  initialEntry: MealCalendarEntry | null
  onSave: (recipeId: string, assignedTo: HouseholdMember) => void
  onClear: () => void
  onClose: () => void
  onViewRecipe: (recipeId: string) => void
}

export function MealSlotPicker({
  isOpen,
  date,
  mealType,
  recipes,
  initialEntry,
  onSave,
  onClear,
  onClose,
  onViewRecipe,
}: MealSlotPickerProps) {
  const [search, setSearch] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)
  const [assignedTo, setAssignedTo] = useState<HouseholdMember>(HOUSEHOLD_MEMBERS[0])

  useEffect(() => {
    if (isOpen) {
      setSelectedRecipeId(initialEntry?.recipeId ?? null)
      setAssignedTo(initialEntry?.assignedTo ?? HOUSEHOLD_MEMBERS[0])
      setSearch('')
    }
  }, [isOpen, initialEntry])

  const visibleRecipes = search.trim()
    ? recipes.filter((r) => r.title.toLowerCase().includes(search.trim().toLowerCase()))
    : recipes

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
                {HOUSEHOLD_MEMBERS.map((member) => (
                  <button
                    key={member}
                    type="button"
                    onClick={() => setAssignedTo(member)}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      assignedTo === member ? 'bg-emerald-500 text-neutral-950' : 'text-white/60'
                    }`}
                  >
                    {member}
                  </button>
                ))}
              </div>

              <input
                type="text"
                placeholder="Search favorites…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-xl bg-neutral-800 px-3 py-2 text-sm placeholder:text-white/40 focus:outline-none"
              />
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
              {visibleRecipes.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/50">
                  {recipes.length === 0 ? 'No favorites yet — swipe right on something first.' : 'No matches.'}
                </p>
              ) : (
                visibleRecipes.map((recipe) => (
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
                ))
              )}
            </div>

            <div className="flex gap-2 border-t border-white/10 p-4">
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
