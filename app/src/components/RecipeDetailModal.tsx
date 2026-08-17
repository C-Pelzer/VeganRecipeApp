import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRecipes } from '../lib/data'
import type { HouseholdMember } from '../lib/profile'
import { recipeOverrideStore } from '../lib/store/recipeOverrideStore'
import { recipePhotoStore } from '../lib/store/recipePhotoStore'
import { recipeTagOverrideStore } from '../lib/store/recipeTagOverrideStore'
import { effectiveTagsByRecipe, groupByCategory, useRecipeTagOverrides, useRecipeTags } from '../lib/tags'
import { provenanceLabel } from '../lib/recipeProvenance'
import type { Ingredient, IngredientGroup, Recipe, RecipeOverride, RecipePhoto, TagCategory } from '../types/recipe'

// One item/step per line, blank lines dropped.
function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function originalIngredientsText(recipe: Recipe): string {
  return recipe.ingredient_groups.flatMap((g) => g.ingredients.map((i) => i.display)).join('\n')
}

// Collapses punctuation (quotes, parens, etc.) into hyphens instead of
// keeping it raw — mirrors scripts/tag-recipes.mjs's slugify, which had the
// same gap and produced deck ids that broke when used in a URL.
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 'book' is deliberately excluded here — a recipe's book isn't a manual
// correction the way cuisine/course can be, and it's already shown
// elsewhere on this screen. It still exists as a TagCategory so
// scripts/build-swipe-decks.mjs can build one deck per cookbook.
const TAG_CATEGORY_LABELS: Partial<Record<TagCategory, string>> = {
  time: 'Time',
  cuisine: 'Cuisine',
  ingredient: 'Ingredient',
  course: 'Course',
}
const TAG_CATEGORY_ORDER = Object.keys(TAG_CATEGORY_LABELS) as TagCategory[]

function IngredientRow({ ingredient }: { ingredient: Ingredient }) {
  const [showRaw, setShowRaw] = useState(false)
  const canReveal = ingredient.raw !== ingredient.display

  return (
    <li
      className={canReveal ? 'cursor-pointer' : undefined}
      onClick={canReveal ? () => setShowRaw((v) => !v) : undefined}
    >
      <p className="text-white/90">
        {ingredient.optional && <span className="text-white/40">(optional) </span>}
        {ingredient.display}
      </p>
      {showRaw && <p className="text-xs text-white/40">{ingredient.raw}</p>}
    </li>
  )
}

function IngredientGroupBlock({ group }: { group: IngredientGroup }) {
  return (
    <div className="rounded-2xl bg-neutral-900 p-4">
      {group.name && (
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-400">
          {group.name}
        </h3>
      )}
      <ul className="space-y-2">
        {group.ingredients.map((ingredient, i) => (
          // raw is the one field guaranteed unique-ish per line within a group
          <IngredientRow key={`${ingredient.raw}-${i}`} ingredient={ingredient} />
        ))}
      </ul>
    </div>
  )
}

interface RecipeDetailModalProps {
  recipeId: string | null
  currentUser: HouseholdMember
  onClose: () => void
}

// A full-screen sheet rather than a route — the deck/favorites/meal-plan
// screen underneath never unmounts, so its state (swipe queue order, session
// progress, tab selection) survives opening and closing this without a route
// change. Sliding up from the bottom (vs. NavDrawer's side slide or
// ConfirmDialog's centered fade) reads as "content on top," not navigation.
export function RecipeDetailModal({ recipeId, currentUser, onClose }: RecipeDetailModalProps) {
  const { recipes } = useRecipes()
  const recipe = recipeId ? recipes?.find((r) => r.id === recipeId) : null

  const [override, setOverride] = useState<RecipeOverride | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [ingredientsDraft, setIngredientsDraft] = useState('')
  const [stepsDraft, setStepsDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const [photos, setPhotos] = useState<RecipePhoto[]>([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [activeSlide, setActiveSlide] = useState(0)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const carouselRef = useRef<HTMLDivElement>(null)

  const { tags } = useRecipeTags()
  const { overrides } = useRecipeTagOverrides()
  const [customTagDrafts, setCustomTagDrafts] = useState<Partial<Record<TagCategory, string>>>({
    time: '',
    cuisine: '',
    ingredient: '',
    course: '',
  })

  const provenance = recipe ? provenanceLabel(recipe) : null
  const knownTagsByCategory = useMemo(() => groupByCategory(tags ?? []), [tags])
  const effectiveTags = useMemo(
    () => (recipeId && tags && overrides ? effectiveTagsByRecipe(tags, overrides).get(recipeId) ?? [] : []),
    [recipeId, tags, overrides],
  )
  const effectiveTagKeys = useMemo(
    () => new Set(effectiveTags.map((t) => `${t.category}::${t.tagSlug}`)),
    [effectiveTags],
  )

  function toggleTag(category: TagCategory, tagSlug: string, label: string) {
    if (!recipe) return
    const key = `${category}::${tagSlug}`
    const isAutoTag =
      tags?.some((t) => t.recipeId === recipe.id && t.category === category && t.tagSlug === tagSlug) ?? false
    if (effectiveTagKeys.has(key)) {
      if (isAutoTag) recipeTagOverrideStore.removeTag(recipe.id, category, tagSlug, label)
      else recipeTagOverrideStore.clearOverride(recipe.id, category, tagSlug)
      return
    }
    const hadRemoveOverride =
      overrides?.some(
        (o) => o.recipeId === recipe.id && o.category === category && o.tagSlug === tagSlug && o.action === 'remove',
      ) ?? false
    if (hadRemoveOverride) recipeTagOverrideStore.clearOverride(recipe.id, category, tagSlug)
    else recipeTagOverrideStore.addTag(recipe.id, category, tagSlug, label)
  }

  function addCustomTag(category: TagCategory) {
    if (!recipe) return
    const label = (customTagDrafts[category] ?? '').trim()
    if (!label) return
    recipeTagOverrideStore.addTag(recipe.id, category, slugify(label), label)
    setCustomTagDrafts((current) => ({ ...current, [category]: '' }))
  }

  useEffect(() => {
    setOverride(null)
    setIsEditing(false)
    if (!recipeId) return
    let cancelled = false
    recipeOverrideStore.getOverride(recipeId).then((data) => {
      if (!cancelled) setOverride(data)
    })
    return () => {
      cancelled = true
    }
  }, [recipeId])

  useEffect(() => {
    setPhotos([])
    setActiveSlide(0)
    setPhotoError(null)
    if (!recipeId) return
    let cancelled = false
    recipePhotoStore.listPhotos(recipeId).then((data) => {
      if (!cancelled) setPhotos(data)
    })
    return () => {
      cancelled = true
    }
  }, [recipeId])

  function handlePhotoSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !recipe) return
    setUploadingPhoto(true)
    setPhotoError(null)
    recipePhotoStore
      .addPhoto(recipe.id, file, currentUser)
      .then((photo) => {
        setPhotos((current) => [...current, photo])
        const el = carouselRef.current
        if (el) el.scrollTo({ left: el.clientWidth * (photos.length + 1), behavior: 'smooth' })
      })
      .catch((err) => setPhotoError(err instanceof Error ? err.message : 'Upload failed.'))
      .finally(() => setUploadingPhoto(false))
  }

  function handleDeletePhoto(photo: RecipePhoto) {
    recipePhotoStore
      .deletePhoto(photo)
      .then(() => {
        setPhotos((current) => current.filter((p) => p.id !== photo.id))
        setActiveSlide((current) => Math.max(0, current - 1))
      })
      .catch((err) => setPhotoError(err instanceof Error ? err.message : 'Delete failed.'))
  }

  function startEditing() {
    if (!recipe) return
    setNotesDraft(override?.notes ?? '')
    setIngredientsDraft(override?.ingredientsOverride || originalIngredientsText(recipe))
    setStepsDraft(override?.stepsOverride || recipe.steps.join('\n'))
    setIsEditing(true)
  }

  function handleSave() {
    if (!recipe) return
    setSaving(true)
    const fields = { notes: notesDraft.trim(), ingredientsOverride: ingredientsDraft.trim(), stepsOverride: stepsDraft.trim() }
    recipeOverrideStore.saveOverride(recipe.id, fields).then(() => {
      setOverride({ recipeId: recipe.id, ...fields, updatedAt: new Date().toISOString() })
      setSaving(false)
      setIsEditing(false)
    })
  }

  // Traps the phone's hardware/browser back button: pushing a same-URL
  // history entry while open means back pops that entry (a popstate event)
  // instead of leaving the current route. If the modal is instead dismissed
  // via the close button, the pushed entry is popped in the cleanup below so
  // a later back press doesn't need an extra tap to "use up" a dead entry.
  const pushedHistoryRef = useRef(false)

  useEffect(() => {
    if (!recipeId) return

    window.history.pushState({ recipeModal: true }, '')
    pushedHistoryRef.current = true

    function handlePopState() {
      pushedHistoryRef.current = false
      onClose()
    }
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false
        window.history.back()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId])

  return (
    <AnimatePresence>
      {recipeId && (
        <motion.div
          key="recipe-modal"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'tween', duration: 0.25 }}
          className="fixed inset-0 z-50 overflow-y-auto bg-neutral-950 pb-[calc(2rem+env(safe-area-inset-bottom))]"
        >
          {!recipe ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white/70">
              <p>Recipe not found.</p>
              <button type="button" onClick={onClose} className="text-emerald-400">
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="relative aspect-[4/3] w-full bg-neutral-800">
                <div
                  ref={carouselRef}
                  className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
                  onScroll={(e) => {
                    const el = e.currentTarget
                    setActiveSlide(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)))
                  }}
                >
                  <div className="h-full w-full shrink-0 snap-center">
                    {recipe.image ? (
                      <img src={recipe.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-800 to-neutral-900 text-6xl">
                        🌱
                      </div>
                    )}
                  </div>
                  {photos.map((photo) => (
                    <div key={photo.id} className="relative h-full w-full shrink-0 snap-center">
                      <img src={photo.photoUrl} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleDeletePhoto(photo)}
                        aria-label="Delete photo"
                        className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-sm text-white backdrop-blur"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {photos.length > 0 && (
                  <div className="absolute bottom-3 left-0 flex w-full justify-center gap-1.5">
                    {Array.from({ length: photos.length + 1 }).map((_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${
                          i === activeSlide ? 'bg-white' : 'bg-white/40'
                        }`}
                      />
                    ))}
                  </div>
                )}

                {uploadingPhoto && (
                  <div className="absolute left-1/2 top-[calc(1rem+env(safe-area-inset-top))] -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white backdrop-blur">
                    Uploading…
                  </div>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute left-4 top-[calc(1rem+env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-lg text-white backdrop-blur"
                >
                  ✕
                </button>
                <div className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] flex gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    aria-label="Add a photo"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-base text-white backdrop-blur disabled:opacity-50"
                  >
                    📷
                  </button>
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={startEditing}
                      aria-label="Edit recipe"
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-base text-white backdrop-blur"
                    >
                      ✎
                    </button>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelected}
                  className="hidden"
                />
              </div>
              {photoError && <p className="px-4 pt-2 text-sm text-red-400">{photoError}</p>}

              <div className="space-y-5 p-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-white/50">
                    {recipe.source_book}
                    {recipe.authors.length > 0 && ` · ${recipe.authors.join(', ')}`}
                  </p>
                  <h1 className="mt-1 text-2xl font-semibold text-white">{recipe.title}</h1>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/60">
                    {recipe.servings_text && <span>{recipe.servings_text}</span>}
                    {recipe.time_text && <span>{recipe.time_text}</span>}
                    <span>{recipe.ingredient_count} ingredients</span>
                  </div>
                  {recipe.diet_tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {recipe.diet_tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-white/70"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {recipe.warnings.length > 0 && (
                  <div className="rounded-2xl border border-amber-700/50 bg-amber-950/30 p-3 text-sm text-amber-200">
                    {recipe.warnings.map((warning) => (
                      <p key={warning}>⚠ {warning}</p>
                    ))}
                  </div>
                )}

                {recipe.headnote && <p className="text-sm leading-relaxed text-white/70">{recipe.headnote}</p>}

                {isEditing ? (
                  <div>
                    <h2 className="mb-2 text-lg font-semibold text-white">Our Notes</h2>
                    <textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="e.g. we always add extra garlic"
                      rows={3}
                      className="w-full rounded-2xl bg-neutral-900 p-3 text-base text-white placeholder:text-white/40"
                    />
                  </div>
                ) : (
                  override?.notes && (
                    <div>
                      <h2 className="mb-2 text-lg font-semibold text-white">Our Notes</h2>
                      <p className="text-sm leading-relaxed text-white/70">{override.notes}</p>
                    </div>
                  )
                )}

                <div>
                  <h2 className="mb-2 text-lg font-semibold text-white">Tags</h2>
                  {isEditing ? (
                    <div className="space-y-4">
                      {provenance && (
                        <span className="inline-block rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
                          {provenance}
                        </span>
                      )}
                      {TAG_CATEGORY_ORDER.map((category) => (
                        <div key={category}>
                          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">
                            {TAG_CATEGORY_LABELS[category]}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {knownTagsByCategory[category].map((tag) => {
                              const checked = effectiveTagKeys.has(`${category}::${tag.slug}`)
                              return (
                                <button
                                  key={tag.slug}
                                  type="button"
                                  onClick={() => toggleTag(category, tag.slug, tag.label)}
                                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    checked
                                      ? 'bg-emerald-500 text-neutral-950'
                                      : 'bg-neutral-900 text-white/60'
                                  }`}
                                >
                                  {tag.label}
                                </button>
                              )
                            })}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <input
                              type="text"
                              value={customTagDrafts[category] ?? ''}
                              onChange={(e) =>
                                setCustomTagDrafts((current) => ({ ...current, [category]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') addCustomTag(category)
                              }}
                              placeholder={`Add ${(TAG_CATEGORY_LABELS[category] ?? '').toLowerCase()} tag…`}
                              className="min-w-0 flex-1 rounded-xl bg-neutral-900 px-3 py-1.5 text-base text-white placeholder:text-white/40 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => addCustomTag(category)}
                              className="shrink-0 rounded-xl bg-neutral-800 px-3 py-1.5 text-xs font-medium text-white/70"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : provenance || effectiveTags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {provenance && (
                        <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
                          {provenance}
                        </span>
                      )}
                      {effectiveTags.map((tag) => (
                        <span
                          key={`${tag.category}::${tag.tagSlug}`}
                          className="rounded-full bg-neutral-800 px-3 py-1 text-xs text-white/70"
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-white/40">No tags yet.</p>
                  )}
                </div>

                <div>
                  <h2 className="mb-2 text-lg font-semibold text-white">Ingredients</h2>
                  {isEditing ? (
                    <textarea
                      value={ingredientsDraft}
                      onChange={(e) => setIngredientsDraft(e.target.value)}
                      placeholder="One ingredient per line"
                      rows={10}
                      className="w-full rounded-2xl bg-neutral-900 p-3 text-base text-white placeholder:text-white/40"
                    />
                  ) : override?.ingredientsOverride ? (
                    <ul className="space-y-2 rounded-2xl bg-neutral-900 p-4">
                      {splitLines(override.ingredientsOverride).map((line, i) => (
                        <li key={i} className="text-white/90">
                          {line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="space-y-3">
                      {recipe.ingredient_groups.map((group, i) => (
                        // group name isn't guaranteed unique (e.g. two null-name groups)
                        <IngredientGroupBlock key={i} group={group} />
                      ))}
                    </div>
                  )}
                </div>

                {(isEditing || recipe.steps.length > 0 || override?.stepsOverride) && (
                  <div>
                    <h2 className="mb-2 text-lg font-semibold text-white">Steps</h2>
                    {isEditing ? (
                      <textarea
                        value={stepsDraft}
                        onChange={(e) => setStepsDraft(e.target.value)}
                        placeholder="One step per line"
                        rows={10}
                        className="w-full rounded-2xl bg-neutral-900 p-3 text-base text-white placeholder:text-white/40"
                      />
                    ) : (
                      <ol className="space-y-3">
                        {(override?.stepsOverride ? splitLines(override.stepsOverride) : recipe.steps).map(
                          (step, i) => (
                            <li key={i} className="flex gap-3 text-sm leading-relaxed text-white/80">
                              <span className="shrink-0 font-semibold text-emerald-400">{i + 1}.</span>
                              <span>{step}</span>
                            </li>
                          ),
                        )}
                      </ol>
                    )}
                  </div>
                )}

                {isEditing && (
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="rounded-full px-4 py-2 text-sm font-medium text-white/70"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}

                {recipe.notes.length > 0 && (
                  <div>
                    <h2 className="mb-2 text-lg font-semibold text-white">Notes</h2>
                    <div className="space-y-2 text-sm text-white/70">
                      {recipe.notes.map((note, i) => (
                        <p key={i}>{note}</p>
                      ))}
                    </div>
                  </div>
                )}

                {recipe.nutrition && (
                  <div>
                    <h2 className="mb-2 text-lg font-semibold text-white">Nutrition</h2>
                    <p className="text-sm text-white/70">{recipe.nutrition}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
