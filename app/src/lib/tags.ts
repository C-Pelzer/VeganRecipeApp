import { useEffect, useState } from 'react'
import { fetchAllRows } from './fetchAllRows'
import { supabase } from './supabaseClient'
import type { RecipeTag, RecipeTagOverride, TagCategory } from '../types/recipe'

interface RecipeTagRow {
  recipe_id: string
  category: TagCategory
  tag_slug: string
  label: string
}

let cache: Promise<RecipeTag[]> | null = null

/**
 * Fetches the full recipe_tags table (see scripts/tag-recipes.mjs). Cached in
 * memory for the life of the tab, same pattern as loadRecipes in data.ts —
 * paginated since one book tag per recipe alone puts this table well past
 * Supabase's default 1000-row-per-request cap.
 */
async function fetchTags(): Promise<RecipeTag[]> {
  const data = await fetchAllRows<RecipeTagRow>((from, to) =>
    supabase.from('recipe_tags').select('*').range(from, to),
  )
  return data.map((row) => ({
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

let overrideCache: Promise<RecipeTagOverride[]> | null = null

/**
 * Fetches the full recipe_tag_overrides table (see
 * app/src/lib/store/recipeTagOverrideStore.ts, which writes to it). Same
 * whole-table caching pattern as useRecipeTags — invalidated on write via
 * invalidateTagOverrides() since, unlike the pipeline tables, this one
 * changes during a session.
 */
interface RecipeTagOverrideRow {
  recipe_id: string
  category: TagCategory
  tag_slug: string
  label: string
  action: 'add' | 'remove'
  updated_at: string
}

async function fetchOverrides(): Promise<RecipeTagOverride[]> {
  const data = await fetchAllRows<RecipeTagOverrideRow>((from, to) =>
    supabase.from('recipe_tag_overrides').select('*').range(from, to),
  )
  return data.map((row) => ({
    recipeId: row.recipe_id,
    category: row.category,
    tagSlug: row.tag_slug,
    label: row.label,
    action: row.action,
    updatedAt: row.updated_at,
  }))
}

const overrideRefetchListeners = new Set<() => void>()

export function invalidateTagOverrides() {
  overrideCache = null
  for (const listener of overrideRefetchListeners) listener()
}

function loadOverrides(): Promise<RecipeTagOverride[]> {
  if (!overrideCache) overrideCache = fetchOverrides()
  return overrideCache
}

interface UseRecipeTagOverridesResult {
  overrides: RecipeTagOverride[] | null
  error: Error | null
}

export function useRecipeTagOverrides(): UseRecipeTagOverridesResult {
  const [overrides, setOverrides] = useState<RecipeTagOverride[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      loadOverrides()
        .then((data) => {
          if (!cancelled) setOverrides(data)
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
        })
    }
    load()
    overrideRefetchListeners.add(load)
    return () => {
      cancelled = true
      overrideRefetchListeners.delete(load)
    }
  }, [])

  return { overrides, error }
}

const CATEGORY_ORDER: TagCategory[] = ['time', 'cuisine', 'ingredient', 'course']

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

/**
 * Per-recipe effective tags: pipeline tags with any 'remove' overrides
 * dropped and any 'add' overrides folded in. Mirrors the merge the pipeline
 * itself does in scripts/build-swipe-decks.mjs, so a recipe's tag editor
 * (RecipeDetailModal) shows exactly what the next deck rebuild would see.
 */
export function effectiveTagsByRecipe(
  tags: RecipeTag[],
  overrides: RecipeTagOverride[],
): Map<string, RecipeTag[]> {
  const byRecipe = new Map<string, Map<string, RecipeTag>>()

  function recipeMap(recipeId: string): Map<string, RecipeTag> {
    if (!byRecipe.has(recipeId)) byRecipe.set(recipeId, new Map())
    return byRecipe.get(recipeId) as Map<string, RecipeTag>
  }

  for (const tag of tags) {
    recipeMap(tag.recipeId).set(`${tag.category}::${tag.tagSlug}`, tag)
  }
  for (const override of overrides) {
    const key = `${override.category}::${override.tagSlug}`
    const map = recipeMap(override.recipeId)
    if (override.action === 'remove') map.delete(key)
    else
      map.set(key, {
        recipeId: override.recipeId,
        category: override.category,
        tagSlug: override.tagSlug,
        label: override.label,
      })
  }

  const result = new Map<string, RecipeTag[]>()
  for (const [recipeId, map] of byRecipe) result.set(recipeId, [...map.values()])
  return result
}
