import { useEffect, useMemo, useState } from 'react'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { mealCalendarStore } from '../../lib/store/mealCalendarStore'
import { mealPlanStore } from '../../lib/store/mealPlanStore'
import { favoritedRecipeIds, unionFavoriteIds } from '../../lib/favorites'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
import { addDays, formatWeekRangeLabel, isSameDay, startOfWeek, toDateKey, weekDates } from '../../lib/weekDates'
import { MealDaySheet } from './MealDaySheet'
import { MealSlotPicker } from './MealSlotPicker'
import { MEMBER_COLOR, UNASSIGNED_COLOR } from './memberColor'
import type { MealCalendarEntry, MealType, Recipe, RecipePriority } from '../../types/recipe'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

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
  const [openDay, setOpenDay] = useState<Date | null>(null)
  const [plannedIds, setPlannedIds] = useState<Set<string> | null>(null)

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
    mealPlanStore.getEntries().then((planEntries) => {
      setPlannedIds(new Set(planEntries.map((e) => e.recipeId)))
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

  // The slot picker shows these as two sections, Meal Plan first — planned
  // recipes come from the full recipe pool (not just favorites) since
  // nothing actually requires a planned recipe to also be favorited.
  const plannedRecipes = useMemo<Recipe[]>(() => {
    if (!recipes || !plannedIds) return []
    return recipes.filter((r) => plannedIds.has(r.id))
  }, [recipes, plannedIds])

  const otherFavoriteRecipes = useMemo<Recipe[]>(() => {
    if (!plannedIds) return favoriteRecipes
    return favoriteRecipes.filter((r) => !plannedIds.has(r.id))
  }, [favoriteRecipes, plannedIds])

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

  function handleSelectMeal(mealType: MealType) {
    if (!openDay) return
    setActiveSlot({ date: openDay, mealType })
    setOpenDay(null)
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

  if (!recipes || !entries || !prioritiesByUser || !plannedIds) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        Loading meal calendar…
      </div>
    )
  }

  const activeEntry = activeSlot
    ? entryByKey.get(`${toDateKey(activeSlot.date)}|${activeSlot.mealType}`) ?? null
    : null

  function entriesForDay(day: Date): Partial<Record<MealType, MealCalendarEntry>> {
    const result: Partial<Record<MealType, MealCalendarEntry>> = {}
    for (const mealType of MEAL_TYPES) {
      const entry = entryByKey.get(`${toDateKey(day)}|${mealType}`)
      if (entry) result[mealType] = entry
    }
    return result
  }

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
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

      <div className="flex flex-1 flex-col gap-1 overflow-hidden">
        <div className="flex gap-1">
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

        {/* One color band per meal, top-to-bottom = breakfast/lunch/dinner,
            so which third you're looking at is always the same regardless
            of the day — tap a day to see recipes and edit. */}
        <div className="flex flex-1 gap-1">
          {days.map((day) => (
            <button
              key={toDateKey(day)}
              type="button"
              onClick={() => setOpenDay(day)}
              className="flex flex-1 flex-col gap-0.5 overflow-hidden rounded-lg"
            >
              {MEAL_TYPES.map((mealType) => {
                const entry = entryByKey.get(`${toDateKey(day)}|${mealType}`)
                const color = entry ? MEMBER_COLOR[entry.assignedTo] : UNASSIGNED_COLOR
                return <span key={mealType} aria-hidden="true" className={`flex-1 ${color}`} />
              })}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-white/50">
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${UNASSIGNED_COLOR}`} /> Unassigned
        </span>
        {HOUSEHOLD_MEMBERS.map((member) => (
          <span key={member} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${MEMBER_COLOR[member]}`} /> {member}
          </span>
        ))}
      </div>

      {openDay && (
        <MealDaySheet
          isOpen={true}
          date={openDay}
          entries={entriesForDay(openDay)}
          recipeById={recipeById}
          onSelectMeal={handleSelectMeal}
          onClose={() => setOpenDay(null)}
        />
      )}

      {activeSlot && (
        <MealSlotPicker
          isOpen={true}
          date={activeSlot.date}
          mealType={activeSlot.mealType}
          plannedRecipes={plannedRecipes}
          favoriteRecipes={otherFavoriteRecipes}
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
