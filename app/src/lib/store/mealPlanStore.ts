import { supabase } from '../supabaseClient'
import { shoppingListStore } from './shoppingListStore'
import { getCurrentHouseholdId } from '../auth'
import type { MealPlanEntry, Recipe } from '../../types/recipe'

interface MealPlanRow {
  recipe_id: string
  added_at: string
}

function rowToEntry(row: MealPlanRow): MealPlanEntry {
  return { recipeId: row.recipe_id, addedAt: row.added_at }
}

async function getEntries(): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase.from('meal_plan_items').select('*')
  if (error) throw error
  return (data ?? []).map(rowToEntry)
}

async function addRecipes(recipeIds: string[]): Promise<void> {
  if (recipeIds.length === 0) return
  const householdId = getCurrentHouseholdId()
  const rows = recipeIds.map((recipe_id) => ({ recipe_id, household_id: householdId }))
  const { error } = await supabase
    .from('meal_plan_items')
    .upsert(rows, { onConflict: 'household_id,recipe_id', ignoreDuplicates: true })
  if (error) throw error
}

// Keeps the shopping list in sync: subtract this recipe's contribution before
// dropping it from the plan, rather than leaving stale quantities behind.
async function removeRecipe(recipe: Recipe): Promise<void> {
  await shoppingListStore.subtractRecipes([recipe])
  const { error } = await supabase.from('meal_plan_items').delete().eq('recipe_id', recipe.id)
  if (error) throw error
}

async function clearAll(): Promise<void> {
  const { error } = await supabase.from('meal_plan_items').delete().not('recipe_id', 'is', null)
  if (error) throw error
}

export const mealPlanStore = { getEntries, addRecipes, removeRecipe, clearAll }
