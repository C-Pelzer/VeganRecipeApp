import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import type { RecipeTag, TagCategory } from '../types/recipe'

let cache: Promise<RecipeTag[]> | null = null

/**
 * Fetches the full recipe_tags table (see scripts/tag-recipes.mjs). Cached in
 * memory for the life of the tab, same pattern as loadRecipes in data.ts —
 * small enough (a few thousand rows) to just load wholesale.
 */
async function fetchTags(): Promise<RecipeTag[]> {
  const { data, error } = await supabase.from('recipe_tags').select('*')
  if (error) throw error
  return (data ?? []).map((row) => ({
    recipeId: row.recipe_id,
    category: row.category,
    tagSlug: row.tag_slug,
    label: row.label,
  }))
}

function loadTags(): Promise<RecipeTag[]> {
  if (!cache) cache = fetchTags()
  return cache
}

interface UseRecipeTagsResult {
  tags: RecipeTag[] | null
  error: Error | null
}

export function useRecipeTags(): UseRecipeTagsResult {
  const [tags, setTags] = useState<RecipeTag[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTags()
      .then((data) => {
        if (!cancelled) setTags(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { tags, error }
}

const CATEGORY_ORDER: TagCategory[] = ['time', 'cuisine', 'ingredient']

/** Distinct (slug, label) pairs per category, in a fixed display order. */
export function groupByCategory(tags: RecipeTag[]): Record<TagCategory, { slug: string; label: string }[]> {
  const seen = new Map<TagCategory, Map<string, string>>()
  for (const category of CATEGORY_ORDER) seen.set(category, new Map())

  for (const tag of tags) {
    seen.get(tag.category)?.set(tag.tagSlug, tag.label)
  }

  const result = {} as Record<TagCategory, { slug: string; label: string }[]>
  for (const category of CATEGORY_ORDER) {
    result[category] = [...(seen.get(category) ?? new Map())]
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }
  return result
}

export function tagSlugsByRecipe(tags: RecipeTag[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const tag of tags) {
    if (!map.has(tag.recipeId)) map.set(tag.recipeId, new Set())
    map.get(tag.recipeId)?.add(tag.tagSlug)
  }
  return map
}
