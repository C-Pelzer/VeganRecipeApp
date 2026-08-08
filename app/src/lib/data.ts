import { useEffect, useState } from 'react'
import { importedRecipeStore } from './store/importedRecipeStore'
import type { Recipe } from '../types/recipe'

let staticCache: Promise<Recipe[]> | null = null

/**
 * Fetches the generated bundle (see scripts/build-bundle.mjs). Cached in
 * memory for the life of the tab; the service worker's CacheFirst strategy
 * (vite.config.ts) is what makes this work offline across reloads.
 */
function loadStaticRecipes(): Promise<Recipe[]> {
  if (!staticCache) {
    staticCache = fetch('/data/recipes.json').then((res) => {
      if (!res.ok) throw new Error(`Failed to load recipe bundle: ${res.status}`)
      return res.json() as Promise<Recipe[]>
    })
  }
  return staticCache
}

interface UseRecipesResult {
  recipes: Recipe[] | null
  error: Error | null
}

// RecipeDetailModal is mounted once for the whole session (see its own
// comment on why), so a plain mount-time fetch would never see a recipe
// imported after that mount. Every live useRecipes() call registers its
// refetch here; importRecipeFromHtml's caller invokes
// invalidateImportedRecipes() once the save lands, and every registered
// instance re-fetches immediately instead of waiting for a remount.
const refetchListeners = new Set<() => void>()

export function invalidateImportedRecipes() {
  refetchListeners.forEach((refetch) => refetch())
}

export function useRecipes(): UseRecipesResult {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    function load() {
      // Imported recipes (scripts/schema-imported-recipes.sql) aren't cached
      // — the table is small, and re-fetching is what lets a freshly-
      // imported recipe show up right away. If the table doesn't exist yet
      // (schema not run), fall back to an empty list rather than breaking
      // the whole app's recipe loading.
      Promise.all([loadStaticRecipes(), importedRecipeStore.getAll().catch(() => [])])
        .then(([staticRecipes, importedRecipes]) => {
          if (!cancelled) setRecipes([...staticRecipes, ...importedRecipes])
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
        })
    }

    load()
    refetchListeners.add(load)
    return () => {
      cancelled = true
      refetchListeners.delete(load)
    }
  }, [])

  return { recipes, error }
}
