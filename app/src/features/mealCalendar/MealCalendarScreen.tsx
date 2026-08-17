import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SegmentedTabs } from '../../components/SegmentedTabs'
import { PLAN_SEGMENTS } from '../../components/segments'
import { useRecipes } from '../../lib/data'
import { store } from '../../lib/store/supabaseStore'
import { mealCalendarStore } from '../../lib/store/mealCalendarStore'
import { mealPlanStore } from '../../lib/store/mealPlanStore'
import { favoritedRecipeIds, unionFavoriteIds } from '../../lib/favorites'
import { getCurrentHouseholdId, listHouseholdMembers, type Profile } from '../../lib/auth'
import { addDays, isSameDay, toDateKey } from '../../lib/weekDates'
import { MealSlotPicker } from './MealSlotPicker'
import { memberColor } from './memberColor'
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

// The carousel runs a fixed window of days rather than paging week by week, so
// yesterday and tomorrow are always half-visible either side of today and a
// swipe moves one day, not seven.
const DAYS_BEFORE = 7
const DAYS_AFTER = 27

export function MealCalendarScreen({ onOpenMenu, onViewRecipe }: MealCalendarScreenProps) {
  const { recipes, error } = useRecipes()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [rangeStart] = useState(() => addDays(new Date(), -DAYS_BEFORE))
  const [focusIndex, setFocusIndex] = useState(DAYS_BEFORE)
  const [entries, setEntries] = useState<MealCalendarEntry[] | null>(null)
  const [entriesError, setEntriesError] = useState<Error | null>(null)
  const [members, setMembers] = useState<Profile[] | null>(null)
  const [prioritiesByUser, setPrioritiesByUser] = useState<Record<string, RecipePriority[]> | null>(null)
  const [activeSlot, setActiveSlot] = useState<SlotSelection | null>(null)
  const [plannedIds, setPlannedIds] = useState<Set<string> | null>(null)

  const days = useMemo(
    () => Array.from({ length: DAYS_BEFORE + 1 + DAYS_AFTER }, (_, i) => addDays(rangeStart, i)),
    [rangeStart],
  )

  // Centres a day without smooth-scrolling on first paint, which would animate
  // from the far left every time the screen mounts.
  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current
    const card = scroller?.children[index] as HTMLElement | undefined
    if (!scroller || !card) return
    scroller.scrollTo({
      left: card.offsetLeft - (scroller.clientWidth - card.clientWidth) / 2,
      behavior,
    })
  }, [])

  function handleScroll() {
    const scroller = scrollerRef.current
    if (!scroller) return
    const centre = scroller.scrollLeft + scroller.clientWidth / 2
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < scroller.children.length; i += 1) {
      const card = scroller.children[i] as HTMLElement
      const distance = Math.abs(card.offsetLeft + card.clientWidth / 2 - centre)
      if (distance < best) {
        best = distance
        nearest = i
      }
    }
    setFocusIndex(nearest)
  }

  useEffect(() => {
    listHouseholdMembers(getCurrentHouseholdId()).then((householdMembers) => {
      setMembers(householdMembers)
      Promise.all(householdMembers.map((m) => store.getPriorities(m.id))).then((results) => {
        const byUser: Record<string, RecipePriority[]> = {}
        householdMembers.forEach((m, i) => {
          byUser[m.id] = results[i]
        })
        setPrioritiesByUser(byUser)
      })
    })
  }, [])

  useEffect(() => {
    mealPlanStore
      .getEntries()
      .then((planEntries) => {
        setPlannedIds(new Set(planEntries.map((e) => e.recipeId)))
      })
      // mealPlanStore throws on a failed fetch and has no offline fallback, and
      // plannedIds is part of the loading guard — so without this the calendar
      // sat on "Loading meal calendar…" forever. The plan list only decides how
      // the slot picker groups suggestions, so an empty set is a fine fallback.
      .catch(() => setPlannedIds(new Set()))
  }, [])

  useEffect(() => {
    let cancelled = false
    mealCalendarStore
      .getEntriesInRange(toDateKey(rangeStart), toDateKey(addDays(rangeStart, days.length - 1)))
      .then((data) => {
        if (!cancelled) setEntries(data)
      })
      .catch((err) => {
        if (!cancelled) setEntriesError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [rangeStart, days.length])

  // Must mirror the loading guard below exactly. When it only checked recipes
  // and entries, a slower plannedIds fetch meant this fired while the loading
  // branch was still rendering, the scroller didn't exist yet, and the carousel
  // opened on the first day of the window instead of today.
  const ready = Boolean(recipes && entries && members && prioritiesByUser && plannedIds)
  useEffect(() => {
    if (ready) scrollToIndex(DAYS_BEFORE, 'auto')
  }, [ready, scrollToIndex])

  const favoriteRecipes = useMemo<Recipe[]>(() => {
    if (!recipes || !members || !prioritiesByUser) return []
    const favoriteIds = unionFavoriteIds(members.map((m) => favoritedRecipeIds(prioritiesByUser[m.id] ?? [])))
    return recipes.filter((r) => favoriteIds.has(r.id))
  }, [recipes, members, prioritiesByUser])

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

  const memberNameById = useMemo(
    () => new Map((members ?? []).map((m) => [m.id, m.displayName || m.email])),
    [members],
  )

  function handleSave(recipeId: string, assignedTo: string) {
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

  if (!recipes || !entries || !members || !prioritiesByUser || !plannedIds) {
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
        <span className="font-medium text-white">Meal Calendar</span>
        <button
          type="button"
          onClick={() => scrollToIndex(DAYS_BEFORE)}
          className="min-h-11 text-sm font-medium text-emerald-400"
        >
          Today
        </button>
      </div>

      <SegmentedTabs segments={PLAN_SEGMENTS} activeTo="/meal-calendar" />

      <p className="mb-2 text-center text-sm font-medium text-white/70">
        {(days[focusIndex] ?? days[0]).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
      </p>

      {/* One tall card per day, neighbours peeking either side. The previous
          version drew three unlabelled colour bands per day across a 7-column
          week, which showed who a meal was assigned to but never what it was. */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden px-[12%] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map((day, index) => {
          const isToday = isSameDay(day, new Date())
          const focused = index === focusIndex
          return (
            <div
              key={toDateKey(day)}
              className={`flex w-[76%] shrink-0 snap-center flex-col rounded-2xl border p-3 transition-opacity ${
                focused ? 'border-neutral-700 bg-neutral-900 opacity-100' : 'border-neutral-800/60 bg-neutral-900/50 opacity-50'
              }`}
            >
              <div className="mb-3 flex items-baseline justify-between">
                <span className={`text-sm font-semibold ${isToday ? 'text-emerald-400' : 'text-white'}`}>
                  {isToday ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'long' })}
                </span>
                <span className="text-xs text-white/50">
                  {day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2">
                {MEAL_TYPES.map((mealType) => {
                  const entry = entryByKey.get(`${toDateKey(day)}|${mealType}`)
                  const recipe = entry ? recipeById.get(entry.recipeId) : undefined
                  return (
                    <button
                      key={mealType}
                      type="button"
                      onClick={() => setActiveSlot({ date: day, mealType })}
                      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-neutral-800/70 p-2.5 text-left"
                    >
                      <span className="flex items-center gap-1.5 text-[0.625rem] uppercase tracking-wide text-white/40">
                        {mealType}
                        {entry && (
                          <span
                            aria-label={`Assigned to ${memberNameById.get(entry.assignedTo) ?? 'a household member'}`}
                            className={`h-1.5 w-1.5 rounded-full ${memberColor(entry.assignedTo)}`}
                          />
                        )}
                      </span>
                      {/* Centred in the remaining height so an empty slot reads as
                          a small affordance rather than a large hole. */}
                      <span className="flex flex-1 items-center">
                        {recipe ? (
                          <span className="flex items-center gap-2">
                            {recipe.image && (
                              <img src={recipe.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                            )}
                            <span className="line-clamp-3 text-xs font-medium leading-snug text-white">
                              {recipe.title}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-white/30">＋ Add</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {activeSlot && (
        <MealSlotPicker
          isOpen={true}
          date={activeSlot.date}
          mealType={activeSlot.mealType}
          members={members}
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
