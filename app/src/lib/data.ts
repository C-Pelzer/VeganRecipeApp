import { useEffect, useState } from 'react'
import type { Recipe } from '../types/recipe'

let cache: Promise<Recipe[]> | null = null

/**
 * Fetches the generated bundle (see scripts/build-bundle.mjs). Cached in
 * memory for the life of the tab; the service worker's CacheFirst strategy
 * (vite.config.ts) is what makes this work offline across reloads.
 */
function loadRecipes(): Promise<Recipe[]> {
  if (!cache) {
    cache = fetch('/data/recipes.json').then((res) => {
      if (!res.ok) throw new Error(`Failed to load recipe bundle: ${res.status}`)
      return res.json() as Promise<Recipe[]>
    })
  }
  return cache
}

interface UseRecipesResult {
  recipes: Recipe[] | null
  error: Error | null
}

export function useRecipes(): UseRecipesResult {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    loadRecipes()
      .then((data) => {
        if (!cancelled) setRecipes(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { recipes, error }
}
