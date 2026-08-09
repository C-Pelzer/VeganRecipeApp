import { supabase } from '../supabaseClient'
import { invalidateTagOverrides } from '../tags'
import type { TagCategory } from '../../types/recipe'

async function addTag(recipeId: string, category: TagCategory, tagSlug: string, label: string): Promise<void> {
  const { error } = await supabase
    .from('recipe_tag_overrides')
    .upsert(
      { recipe_id: recipeId, category, tag_slug: tagSlug, label, action: 'add' },
      { onConflict: 'recipe_id,category,tag_slug' },
    )
  if (error) throw error
  invalidateTagOverrides()
}

async function removeTag(recipeId: string, category: TagCategory, tagSlug: string, label: string): Promise<void> {
  const { error } = await supabase
    .from('recipe_tag_overrides')
    .upsert(
      { recipe_id: recipeId, category, tag_slug: tagSlug, label, action: 'remove' },
      { onConflict: 'recipe_id,category,tag_slug' },
    )
  if (error) throw error
  invalidateTagOverrides()
}

/** Reverts to whatever the pipeline says — deletes the override row entirely. */
async function clearOverride(recipeId: string, category: TagCategory, tagSlug: string): Promise<void> {
  const { error } = await supabase
    .from('recipe_tag_overrides')
    .delete()
    .eq('recipe_id', recipeId)
    .eq('category', category)
    .eq('tag_slug', tagSlug)
  if (error) throw error
  invalidateTagOverrides()
}

export const recipeTagOverrideStore = { addTag, removeTag, clearOverride }
