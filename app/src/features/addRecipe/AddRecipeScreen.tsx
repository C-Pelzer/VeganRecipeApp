import { useState, type ChangeEvent } from 'react'
import { SegmentedTabs } from '../../components/SegmentedTabs'
import { CATALOG_SEGMENTS } from '../../components/segments'
import { invalidateImportedRecipes } from '../../lib/data'
import { generateId } from '../../lib/generateId'
import { buildManualRecipe } from '../../lib/recipeImport/buildManualRecipe'
import { importedRecipeStore } from '../../lib/store/importedRecipeStore'
import { uploadPhoto } from '../../lib/uploadPhoto'
import type { HouseholdMember } from '../../lib/profile'

interface AddRecipeScreenProps {
  currentUser: HouseholdMember
  onOpenMenu: () => void
  onViewRecipe: (recipeId: string) => void
}

// One item/step per line, blank lines dropped — same convention
// RecipeDetailModal's ingredient/step overrides use.
function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function AddRecipeScreen({ currentUser, onOpenMenu, onViewRecipe }: AddRecipeScreenProps) {
  const [title, setTitle] = useState('')
  const [servingsText, setServingsText] = useState('')
  const [timeText, setTimeText] = useState('')
  const [headnote, setHeadnote] = useState('')
  const [ingredientsText, setIngredientsText] = useState('')
  const [stepsText, setStepsText] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const ingredientLines = splitLines(ingredientsText)
  const canSave = title.trim().length > 0 && ingredientLines.length > 0 && !saving

  function handlePhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreviewUrl(URL.createObjectURL(file))
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setErrorMessage(null)

    const id = `manual-${generateId()}`

    try {
      let image: string | null = null
      if (photoFile) {
        image = await uploadPhoto(id, photoFile, 'hero')
      }

      const recipe = buildManualRecipe(id, {
        title: title.trim(),
        sourceBook: currentUser === 'Cameron' ? "Cameron's Recipes" : "Mallorie's Recipes",
        servingsText: servingsText.trim(),
        timeText: timeText.trim(),
        headnote: headnote.trim(),
        ingredientLines,
        stepLines: splitLines(stepsText),
        image,
      })

      await importedRecipeStore.add(recipe, 'manual', currentUser)
      invalidateImportedRecipes()
      onViewRecipe(recipe.id)

      setTitle('')
      setServingsText('')
      setTimeText('')
      setHeadnote('')
      setIngredientsText('')
      setStepsText('')
      setPhotoFile(null)
      setPhotoPreviewUrl(null)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Add a Recipe</span>
        <span className="w-4" />
      </div>

      <SegmentedTabs segments={CATALOG_SEGMENTS} activeTo="/add-recipe" />

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">Title</p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Grandma's Lentil Soup"
            className="w-full rounded-xl bg-neutral-900 px-3 py-3 text-base text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">Servings</p>
            <input
              type="text"
              value={servingsText}
              onChange={(e) => setServingsText(e.target.value)}
              placeholder="e.g. 4 servings"
              className="w-full rounded-xl bg-neutral-900 px-3 py-3 text-base text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">Time</p>
            <input
              type="text"
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="e.g. 30 min"
              className="w-full rounded-xl bg-neutral-900 px-3 py-3 text-base text-white placeholder:text-white/40 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">About (optional)</p>
          <textarea
            value={headnote}
            onChange={(e) => setHeadnote(e.target.value)}
            placeholder="A quick note about this recipe"
            rows={2}
            className="w-full rounded-2xl bg-neutral-900 p-3 text-base text-white placeholder:text-white/40"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
            Ingredients — one per line
          </p>
          <textarea
            value={ingredientsText}
            onChange={(e) => setIngredientsText(e.target.value)}
            placeholder={'1 cup flour\n2 tbsp olive oil\n1 onion, diced'}
            rows={8}
            className="w-full rounded-2xl bg-neutral-900 p-3 text-base text-white placeholder:text-white/40"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
            Steps — one per line
          </p>
          <textarea
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            placeholder={'Heat the oil in a large pot.\nAdd the onion and cook until soft.'}
            rows={8}
            className="w-full rounded-2xl bg-neutral-900 p-3 text-base text-white placeholder:text-white/40"
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">Photo (optional)</p>
          <label className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-neutral-900">
              {photoPreviewUrl ? (
                <img src={photoPreviewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl">🌱</div>
              )}
            </div>
            <span className="rounded-full bg-neutral-800 px-4 py-2 text-sm font-medium text-white/70">
              {photoFile ? 'Change photo' : 'Choose photo'}
            </span>
            <input type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />
          </label>
        </div>

        {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}

        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="w-full rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-950 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Recipe'}
        </button>
      </div>
    </div>
  )
}
