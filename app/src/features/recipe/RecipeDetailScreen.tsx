import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import type { Ingredient, IngredientGroup } from '../../types/recipe'

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

export function RecipeDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const { recipes, error } = useRecipes()

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load recipes.
      </div>
    )
  }

  if (!recipes) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">Loading…</div>
    )
  }

  const recipe = recipes.find((r) => r.id === id)
  if (!recipe) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white/70">
        <p>Recipe not found.</p>
        <Link to="/" className="text-emerald-400">
          Back to deck
        </Link>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto pb-8">
      <div className="relative aspect-[4/3] w-full bg-neutral-800">
        {recipe.image ? (
          <img src={recipe.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-800 to-neutral-900 text-6xl">
            🌱
          </div>
        )}
        <Link
          to="/"
          aria-label="Back"
          className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-lg text-white backdrop-blur"
        >
          ←
        </Link>
      </div>

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

        <div>
          <h2 className="mb-2 text-lg font-semibold text-white">Ingredients</h2>
          <div className="space-y-3">
            {recipe.ingredient_groups.map((group, i) => (
              // group name isn't guaranteed unique (e.g. two null-name groups)
              <IngredientGroupBlock key={i} group={group} />
            ))}
          </div>
        </div>

        {recipe.steps.length > 0 && (
          <div>
            <h2 className="mb-2 text-lg font-semibold text-white">Steps</h2>
            <ol className="space-y-3">
              {recipe.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-white/80">
                  <span className="shrink-0 font-semibold text-emerald-400">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
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
    </div>
  )
}
