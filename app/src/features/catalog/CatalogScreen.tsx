import { useMemo, useState } from 'react'
import { useRecipes } from '../../lib/data'
import type { Recipe } from '../../types/recipe'

interface CatalogScreenProps {
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

function searchableText(recipe: Recipe): string {
  const ingredientText = recipe.ingredient_groups
    .flatMap((g) => g.ingredients.map((i) => i.display))
    .join(' ')
  return `${recipe.title} ${recipe.headnote ?? ''} ${ingredientText}`.toLowerCase()
}

export function CatalogScreen({ onOpenMenu, onViewRecipe }: CatalogScreenProps) {
  const { recipes, error } = useRecipes()
  const [query, setQuery] = useState('')

  const sorted = useMemo<Recipe[]>(() => {
    if (!recipes) return []
    return [...recipes].sort((a, b) => a.title.localeCompare(b.title))
  }, [recipes])

  const results = useMemo<Recipe[]>(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return sorted
    return sorted.filter((recipe) => {
      const text = searchableText(recipe)
      return words.every((word) => text.includes(word))
    })
  }, [sorted, query])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load recipes.
      </div>
    )
  }

  if (!recipes) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">Loading catalog…</div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Catalog</span>
        <span className="text-white/50">{results.length}</span>
      </div>

      <input
        type="text"
        placeholder="Search by title or ingredient…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 rounded-xl bg-neutral-900 px-3 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
      />

      {results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-white/60">
          No recipes match "{query}".
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto pb-4">
          {results.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => onViewRecipe(recipe.id)}
              className="flex w-full items-center gap-3 rounded-2xl bg-neutral-900 p-3 text-left"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                {recipe.image ? (
                  <img src={recipe.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl">🌱</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs uppercase tracking-wide text-white/50">
                  {recipe.source_book}
                </p>
                <p className="truncate font-medium text-white">{recipe.title}</p>
                <p className="text-xs text-white/50">{recipe.ingredient_count} ingredients</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
