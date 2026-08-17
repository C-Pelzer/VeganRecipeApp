import { supabase } from '../supabaseClient'
import { getCurrentHouseholdId } from '../auth'
import type { MealCalendarEntry, MealType } from '../../types/recipe'

interface MealCalendarRow {
  entry_date: string
  meal_type: MealType
  recipe_id: string
  assigned_to: string
  updated_at: string
}

function rowToEntry(row: MealCalendarRow): MealCalendarEntry {
  return {
    entryDate: row.entry_date,
    mealType: row.meal_type,
    recipeId: row.recipe_id,
    assignedTo: row.assigned_to,
    updatedAt: row.updated_at,
  }
}

async function getEntriesInRange(startDate: string, endDate: string): Promise<MealCalendarEntry[]> {
  const { data, error } = await supabase
    .from('meal_calendar_entries')
    .select('*')
    .gte('entry_date', startDate)
    .lte('entry_date', endDate)
  if (error) throw error
  return (data ?? []).map(rowToEntry)
}

async function setSlot(entryDate: string, mealType: MealType, recipeId: string, assignedTo: string): Promise<void> {
  const { error } = await supabase.from('meal_calendar_entries').upsert(
    {
      entry_date: entryDate,
      meal_type: mealType,
      recipe_id: recipeId,
      assigned_to: assignedTo,
      household_id: getCurrentHouseholdId(),
    },
    { onConflict: 'household_id,entry_date,meal_type' },
  )
  if (error) throw error
}

async function clearSlot(entryDate: string, mealType: MealType): Promise<void> {
  const { error } = await supabase
    .from('meal_calendar_entries')
    .delete()
    .eq('entry_date', entryDate)
    .eq('meal_type', mealType)
  if (error) throw error
}

export const mealCalendarStore = { getEntriesInRange, setSlot, clearSlot }
