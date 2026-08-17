import { useMemo, useState } from 'react'
import { SegmentedTabs } from '../../components/SegmentedTabs'
import { CATALOG_SEGMENTS } from '../../components/segments'
import { useNavigate } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { deckStore } from '../../lib/store/deckStore'
import { provenanceLabel } from '../../lib/recipeProvenance'
import type { HouseholdMember } from '../../lib/profile'
import type { Recipe } from '../../types/recipe'

const MAX_DECK_SIZE = 40

interface CatalogScreenProps {
  currentUser: HouseholdMember
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

function searchableText(recipe: Recipe): string {
  const ingredientText = recipe.ingredient_groups
    .flatMap((g) => g.ingredients.map((i) => i.display))
    .join(' ')
  return `${recipe.title} ${recipe.headnote ?? ''} ${ingredientText}`.toLowerCase()
}

export function CatalogScreen({ currentUser, onOpenMenu, onViewRecipe }: CatalogScreenProps) {
  const navigate = useNavigate()
  const { recipes, error } = useRecipes()
  const [query, setQuery] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [naming, setNaming] = useState(false)
  const [deckLabel, setDeckLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

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

  function toggleSelecting() {
    setSelecting((current) => !current)
    setSelectedIds(new Set())
    setCreateError(null)
  }

  function toggleSelected(recipeId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(recipeId)) next.delete(recipeId)
      else if (next.size < MAX_DECK_SIZE) next.add(recipeId)
      return next
    })
  }

  function handleCreateDeck() {
    const label = deckLabel.trim()
    if (!label || selectedIds.size === 0) return
    setCreating(true)
    setCreateError(null)
    deckStore
      .createDeck(label, [...selectedIds], currentUser)
      .then((deck) => {
        setNaming(false)
        setSelecting(false)
        setSelectedIds(new Set())
        setDeckLabel('')
        navigate(`/deck/${deck.id}`)
      })
      .catch((err) => setCreateError(err instanceof Error ? err.message : 'Something went wrong.'))
      .finally(() => setCreating(false))
  }

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
    <div className="relative flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Catalog</span>
        <button
          type="button"
          onClick={toggleSelecting}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            selecting ? 'bg-emerald-500 text-neutral-950' : 'bg-neutral-900 text-white/70'
          }`}
        >
          {selecting ? 'Cancel' : 'Build Deck'}
        </button>
      </div>

      <SegmentedTabs segments={CATALOG_SEGMENTS} activeTo="/catalog" />

      <div className="mb-4 flex items-center justify-between gap-3">
        <input
          type="text"
          placeholder="Search by title or ingredient…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-xl bg-neutral-900 px-3 py-3 text-base text-white placeholder:text-white/40 focus:outline-none"
        />
        <span className="shrink-0 text-xs text-white/50">
          {selecting ? `${selectedIds.size}/${MAX_DECK_SIZE}` : results.length}
        </span>
      </div>

      {results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-white/60">
          No recipes match "{query}".
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-16">
          {results.map((recipe) => (
            <div key={recipe.id} className="flex items-center gap-3 rounded-2xl bg-neutral-900 p-3">
              {selecting && (
                <input
                  type="checkbox"
                  aria-label={`Select ${recipe.title}`}
                  checked={selectedIds.has(recipe.id)}
                  disabled={!selectedIds.has(recipe.id) && selectedIds.size >= MAX_DECK_SIZE}
                  onChange={() => toggleSelected(recipe.id)}
                  className="h-5 w-5 shrink-0 accent-emerald-500 disabled:opacity-30"
                />
              )}
              <button
                type="button"
                onClick={() => onViewRecipe(recipe.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
                  {recipe.image ? (
                    <img src={recipe.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">🌱</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-xs uppercase tracking-wide text-white/50">
                      {recipe.source_book}
                    </p>
                    {provenanceLabel(recipe) && (
                      <span className="shrink-0 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                        {provenanceLabel(recipe)}
                      </span>
                    )}
                  </div>
                  <p className="truncate font-medium text-white">{recipe.title}</p>
                  <p className="text-xs text-white/50">{recipe.ingredient_count} ingredients</p>
                </div>
              </button>
            </div>
          ))}
        </div>
      )}

      {selecting && selectedIds.size > 0 && !naming && (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 shadow-lg"
        >
          Create Deck ({selectedIds.size})
        </button>
      )}

      {naming && (
        <>
          <div
            onClick={() => !creating && setNaming(false)}
            className="fixed inset-0 z-40 bg-black/60"
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-neutral-900 p-4 text-white">
            <h2 className="text-base font-semibold">Name this deck</h2>
            <input
              type="text"
              autoFocus
              placeholder="e.g. Friday Date Night"
              value={deckLabel}
              onChange={(e) => setDeckLabel(e.target.value)}
              className="mt-3 w-full rounded-xl bg-neutral-800 px-3 py-2 text-base text-white placeholder:text-white/40 focus:outline-none"
            />
            {createError && <p className="mt-2 text-xs text-rose-400">{createError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNaming(false)}
                disabled={creating}
                className="rounded-full px-4 py-2 text-sm font-medium text-white/70 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateDeck}
                disabled={creating || !deckLabel.trim()}
                className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
