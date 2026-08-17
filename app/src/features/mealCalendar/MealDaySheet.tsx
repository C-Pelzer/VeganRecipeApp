import { AnimatePresence, motion } from 'framer-motion'
import { memberColor } from './memberColor'
import type { MealCalendarEntry, MealType, Recipe } from '../../types/recipe'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']
const MEAL_TYPE_ICONS: Record<MealType, string> = { breakfast: '🌅', lunch: '🥗', dinner: '🌙' }
const MEAL_TYPE_LABELS: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }

interface MealDaySheetProps {
  isOpen: boolean
  date: Date
  entries: Partial<Record<MealType, MealCalendarEntry>>
  recipeById: Map<string, Recipe>
  onSelectMeal: (mealType: MealType) => void
  onClose: () => void
}

// The drill-down step between the week grid's color bands and the actual
// recipe picker (MealSlotPicker) — one tap here narrows a whole day down to
// a single (date, mealType) slot, then hands off to that existing sheet.
export function MealDaySheet({ isOpen, date, entries, recipeById, onSelectMeal, onClose }: MealDaySheetProps) {
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
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-neutral-900 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <p className="font-medium">
                {date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </p>
              <button type="button" onClick={onClose} className="text-base leading-none text-white/50">
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2 p-4">
              {MEAL_TYPES.map((mealType) => {
                const entry = entries[mealType]
                const recipe = entry ? recipeById.get(entry.recipeId) : undefined
                return (
                  <button
                    key={mealType}
                    type="button"
                    onClick={() => onSelectMeal(mealType)}
                    className="flex items-center gap-3 rounded-2xl bg-neutral-800 p-3 text-left"
                  >
                    <span className="text-xl">{MEAL_TYPE_ICONS[mealType]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-wide text-white/50">
                        {MEAL_TYPE_LABELS[mealType]}
                      </p>
                      {recipe ? (
                        <p className="truncate font-medium">{recipe.title}</p>
                      ) : (
                        <p className="text-white/40">Tap to add</p>
                      )}
                    </div>
                    {entry && (
                      <span
                        aria-label={`Assigned to ${entry.assignedTo}`}
                        className={`h-3 w-3 shrink-0 rounded-full ${memberColor(entry.assignedTo)}`}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
