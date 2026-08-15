import { useState } from 'react'
import { invalidateImportedRecipes } from '../../lib/data'
import { importedRecipeStore } from '../../lib/store/importedRecipeStore'
import { importRecipeFromHtml, type ImportResult } from '../../lib/recipeImport/mapToRecipe'
import type { HouseholdMember } from '../../lib/profile'

interface ImportRecipeScreenProps {
  currentUser: HouseholdMember
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

type Status = 'idle' | 'fetching' | 'preview' | 'saving'

export function ImportRecipeScreen({ currentUser, onOpenMenu, onViewRecipe }: ImportRecipeScreenProps) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function handleFetch() {
    const trimmed = url.trim()
    if (!trimmed) return
    setStatus('fetching')
    setErrorMessage(null)
    setResult(null)

    importedRecipeStore
      .fetchPage(trimmed)
      .then(({ html, finalUrl }) => {
        const parsed = importRecipeFromHtml(html, finalUrl)
        if (!parsed) {
          setStatus('idle')
          setErrorMessage("Couldn't find a recipe on that page. It may not use a supported recipe format.")
          return
        }
        setSourceUrl(finalUrl)
        setResult(parsed)
        setStatus('preview')
      })
      .catch((err) => {
        setStatus('idle')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      })
  }

  async function handleSave() {
    if (!result) return
    setStatus('saving')

    let recipeToSave = result.recipe
    if (recipeToSave.image) {
      try {
        const hostedImage = await importedRecipeStore.snapshotImage(recipeToSave.id, recipeToSave.image)
        recipeToSave = { ...recipeToSave, image: hostedImage }
      } catch {
        // Keep the original external URL — a failed snapshot shouldn't block the
        // import. But record it: a hotlinked image falls outside the PWA's cache
        // rule (which only matches the Supabase bucket), so the recipe silently
        // has no photo offline. The warning is also what a later backfill uses to
        // find these rows.
        recipeToSave = {
          ...recipeToSave,
          warnings: [...recipeToSave.warnings, "Couldn't save a copy of the photo — it won't be available offline."],
        }
      }
    }

    try {
      await importedRecipeStore.add(recipeToSave, sourceUrl, currentUser)
      invalidateImportedRecipes()
      onViewRecipe(recipeToSave.id)
      setUrl('')
      setResult(null)
      setStatus('idle')
    } catch (err) {
      setStatus('preview')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  function handleStartOver() {
    setResult(null)
    setStatus('idle')
    setErrorMessage(null)
  }

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Import Recipe</span>
        <span className="w-4" />
      </div>

      {!result ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-white/60">Paste a link to a recipe on any cooking website.</p>
          <input
            type="url"
            inputMode="url"
            placeholder="https://example.com/some-vegan-recipe"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="rounded-xl bg-neutral-900 px-3 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleFetch}
            disabled={!url.trim() || status === 'fetching'}
            className="rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-40"
          >
            {status === 'fetching' ? 'Fetching…' : 'Fetch Recipe'}
          </button>
          {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
        </div>
      ) : (
        <div className="flex-1 space-y-4 overflow-y-auto pb-4">
          <div className="flex gap-3 rounded-2xl bg-neutral-900 p-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-neutral-800">
              {result.recipe.image ? (
                <img src={result.recipe.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl">🌱</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs uppercase tracking-wide text-white/50">{result.recipe.source_book}</p>
              <p className="font-medium text-white">{result.recipe.title}</p>
              <p className="text-xs text-white/50">
                {result.recipe.ingredient_count} ingredients
                {result.recipe.time_text ? ` · ${result.recipe.time_text}` : ''}
                {result.recipe.servings_text ? ` · ${result.recipe.servings_text}` : ''}
              </p>
            </div>
          </div>

          {result.warnings.length > 0 && (
            <div className="rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-300">
              <ul className="list-inside list-disc space-y-1">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl bg-neutral-900 p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/50">Ingredients</p>
            <ul className="space-y-1 text-sm text-white/80">
              {result.recipe.ingredient_groups[0]?.ingredients.map((ing, i) => (
                <li key={i}>{ing.display}</li>
              ))}
            </ul>
          </div>

          {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleStartOver}
              className="rounded-full px-4 py-3 text-sm font-medium text-white/70"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={status === 'saving'}
              className="ml-auto rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-40"
            >
              {status === 'saving' ? 'Saving…' : 'Save Recipe'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
