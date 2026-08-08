import { useEffect, useMemo, useState } from 'react'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { mealCalendarStore } from '../../lib/store/mealCalendarStore'
import { favoritedRecipeIds, unionFavoriteIds } from '../../lib/favorites'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
import { addDays, formatWeekRangeLabel, isSameDay, startOfWeek, toDateKey, weekDates } from '../../lib/weekDates'
import { MealSlotPicker } from './MealSlotPicker'
import type { MealCalendarEntry, MealType, Recipe, RecipePriority } from '../../types/recipe'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']
const MEAL_TYPE_ICONS: Record<MealType, string> = { breakfast: '🌅', lunch: '🥗', dinner: '🌙' }

interface MealCalendarScreenProps {
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

interface SlotSelection {
  date: Date
  mealType: MealType
}

export function MealCalendarScreen({ onOpenMenu, onViewRecipe }: MealCalendarScreenProps) {
  const { recipes, error } = useRecipes()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [entries, setEntries] = useState<MealCalendarEntry[] | null>(null)
  const [entriesError, setEntriesError] = useState<Error | null>(null)
  const [prioritiesByUser, setPrioritiesByUser] = useState<Record<
    HouseholdMember,
    RecipePriority[]
  > | null>(null)
  const [activeSlot, setActiveSlot] = useState<SlotSelection | null>(null)

  const days = useMemo(() => weekDates(weekStart), [weekStart])

  useEffect(() => {
    Promise.all(HOUSEHOLD_MEMBERS.map((user) => store.getPriorities(user))).then((results) => {
      const byUser = {} as Record<HouseholdMember, RecipePriority[]>
      HOUSEHOLD_MEMBERS.forEach((user, i) => {
        byUser[user] = results[i]
      })
      setPrioritiesByUser(byUser)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    mealCalendarStore
      .getEntriesInRange(toDateKey(weekStart), toDateKey(addDays(weekStart, 6)))
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch((err) => {
        if (!cancelled) setEntriesError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [weekStart])

  const favoriteRecipes = useMemo<Recipe[]>(() => {
    if (!recipes || !prioritiesByUser) return []
    const [a, b] = HOUSEHOLD_MEMBERS.map((user) => favoritedRecipeIds(prioritiesByUser[user] ?? []))
    const favoriteIds = unionFavoriteIds(a, b)
    return recipes.filter((r) => favoriteIds.has(r.id))
  }, [recipes, prioritiesByUser])

  const entryByKey = useMemo(() => {
    const map = new Map<string, MealCalendarEntry>()
    for (const entry of entries ?? []) {
      map.set(`${entry.entryDate}|${entry.mealType}`, entry)
    }
    return map
  }, [entries])

  const recipeById = useMemo(() => {
    const map = new Map<string, Recipe>()
    for (const recipe of recipes ?? []) map.set(recipe.id, recipe)
    return map
  }, [recipes])

  function handleSlotClick(date: Date, mealType: MealType) {
    setActiveSlot({ date, mealType })
  }

  function handleSave(recipeId: string, assignedTo: HouseholdMember) {
    if (!activeSlot) return
    const entryDate = toDateKey(activeSlot.date)
    const mealType = activeSlot.mealType
    mealCalendarStore.setSlot(entryDate, mealType, recipeId, assignedTo).then(() => {
      setEntries((current) => {
        const next = (current ?? []).filter((e) => !(e.entryDate === entryDate && e.mealType === mealType))
        next.push({ entryDate, mealType, recipeId, assignedTo, updatedAt: new Date().toISOString() })
        return next
      })
      setActiveSlot(null)
    })
  }

  function handleClear() {
    if (!activeSlot) return
    const entryDate = toDateKey(activeSlot.date)
    const mealType = activeSlot.mealType
    mealCalendarStore.clearSlot(entryDate, mealType).then(() => {
      setEntries((current) => (current ?? []).filter((e) => !(e.entryDate === entryDate && e.mealType === mealType)))
      setActiveSlot(null)
    })
  }

  if (error || entriesError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load the meal calendar. Try reloading.
      </div>
    )
  }

  if (!recipes || !entries || !prioritiesByUser) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        Loading meal calendar…
      </div>
    )
  }

  const activeEntry = activeSlot
    ? entryByKey.get(`${toDateKey(activeSlot.date)}|${activeSlot.mealType}`) ?? null
    : null

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Meal Calendar</span>
        <button
          type="button"
          onClick={() => setWeekStart(startOfWeek(new Date()))}
          className="text-sm font-medium text-emerald-400"
        >
          Today
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setWeekStart((current) => addDays(current, -7))}
          className="px-2 text-lg text-white/50"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-white/70">{formatWeekRangeLabel(weekStart)}</span>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => setWeekStart((current) => addDays(current, 7))}
          className="px-2 text-lg text-white/50"
        >
          ›
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-1">
          <div className="w-8 shrink-0" />
          {days.map((day) => (
            <div
              key={toDateKey(day)}
              className={`flex-1 rounded-lg py-1 text-center text-xs ${
                isSameDay(day, new Date()) ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/50'
              }`}
            >
              <p className="font-medium">{day.toLocaleDateString(undefined, { weekday: 'short' })}</p>
              <p>{day.getDate()}</p>
            </div>
          ))}
        </div>

        {MEAL_TYPES.map((mealType) => (
          <div key={mealType} className="mt-1 flex gap-1">
            <div className="flex w-8 shrink-0 items-center justify-center text-base">
              {MEAL_TYPE_ICONS[mealType]}
            </div>
            {days.map((day) => {
              const entry = entryByKey.get(`${toDateKey(day)}|${mealType}`)
              const recipe = entry ? recipeById.get(entry.recipeId) : undefined
              return (
                <button
                  key={toDateKey(day)}
                  type="button"
                  onClick={() => handleSlotClick(day, mealType)}
                  className={`min-h-16 flex-1 rounded-lg p-1 text-left ${
                    entry ? 'bg-neutral-800' : 'border border-dashed border-white/10 bg-neutral-900'
                  }`}
                >
                  {entry && recipe ? (
                    <>
                      <span className="line-clamp-2 text-[10px] leading-tight text-white">{recipe.title}</span>
                      <span className="mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-semibold text-neutral-950">
                        {entry.assignedTo[0]}
                      </span>
                    </>
                  ) : (
                    <span className="flex h-full items-center justify-center text-white/20">+</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {activeSlot && (
        <MealSlotPicker
          isOpen={true}
          date={activeSlot.date}
          mealType={activeSlot.mealType}
          recipes={favoriteRecipes}
          initialEntry={activeEntry}
          onSave={handleSave}
          onClear={handleClear}
          onClose={() => setActiveSlot(null)}
          onViewRecipe={(recipeId) => {
            setActiveSlot(null)
            onViewRecipe(recipeId)
          }}
        />
      )}
    </div>
  )
}
