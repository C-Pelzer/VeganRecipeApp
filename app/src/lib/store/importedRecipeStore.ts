import { supabase } from '../supabaseClient'
import { getCurrentHouseholdId } from '../auth'
import type { Recipe } from '../../types/recipe'

interface ImportedRecipeRow {
  id: string
  source_url: string
  added_by: string
  recipe_data: Recipe
  created_at: string
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const { data, error } = await supabase.functions.invoke<{ html: string; finalUrl: string; error?: string }>(
    'fetch-page',
    { body: { url } },
  )
  if (error) throw error
  if (!data || data.error) throw new Error(data?.error ?? 'Failed to fetch the page')
  return data
}

// Downscales the recipe's photo server-side and re-hosts it in the same
// Storage bucket the cookbook pipeline uses, instead of hotlinking the
// source site (which can disappear or block hotlinking). Throws on failure
// — callers should keep the original external URL rather than block the
// import over a snapshot failure.
async function snapshotImage(recipeId: string, imageUrl: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ publicUrl: string; error?: string }>('fetch-page', {
    body: { url: imageUrl, mode: 'image', recipeId },
  })
  if (error) throw error
  if (!data || data.error) throw new Error(data?.error ?? 'Failed to snapshot the image')
  return data.publicUrl
}

async function getAll(): Promise<Recipe[]> {
  const { data, error } = await supabase.from('imported_recipes').select('*')
  if (error) throw error
  return ((data ?? []) as ImportedRecipeRow[]).map((row) => row.recipe_data)
}

async function add(recipe: Recipe, sourceUrl: string, addedBy: string): Promise<void> {
  const { error } = await supabase.from('imported_recipes').insert({
    id: recipe.id,
    source_url: sourceUrl,
    added_by: addedBy,
    recipe_data: recipe,
    household_id: getCurrentHouseholdId(),
  })
  if (error) throw error
}

export const importedRecipeStore = { fetchPage, snapshotImage, getAll, add }
