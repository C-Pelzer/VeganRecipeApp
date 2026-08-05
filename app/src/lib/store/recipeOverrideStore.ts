import { supabase } from '../supabaseClient'
import type { RecipeOverride } from '../../types/recipe'

interface RecipeOverrideRow {
  recipe_id: string
  notes: string
  ingredients_override: string
  steps_override: string
  updated_at: string
}

function rowToOverride(row: RecipeOverrideRow): RecipeOverride {
  return {
    recipeId: row.recipe_id,
    notes: row.notes,
    ingredientsOverride: row.ingredients_override,
    stepsOverride: row.steps_override,
    updatedAt: row.updated_at,
  }
}

// Fetched per-recipe on demand (unlike recipe_tags/recipes.json, which are
// genuinely bulk-loaded every session) — this is only looked up once per
// modal open, and most recipes will never have a row at all.
async function getOverride(recipeId: string): Promise<RecipeOverride | null> {
  const { data, error } = await supabase
    .from('recipe_overrides')
    .select('*')
    .eq('recipe_id', recipeId)
    .maybeSingle()
  if (error) throw error
  return data ? rowToOverride(data) : null
}

async function saveOverride(
  recipeId: string,
  fields: { notes: string; ingredientsOverride: string; stepsOverride: string },
): Promise<void> {
  const { error } = await supabase.from('recipe_overrides').upsert({
    recipe_id: recipeId,
    notes: fields.notes,
    ingredients_override: fields.ingredientsOverride,
    steps_override: fields.stepsOverride,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

export const recipeOverrideStore = { getOverride, saveOverride }
