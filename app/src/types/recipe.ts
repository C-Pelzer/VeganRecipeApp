// Mirrors the schema documented in CLAUDE_CODE_BRIEF.md. Keep in sync with
// scripts/build-bundle.mjs, which is the only thing that produces this shape.

export type GramsSource =
  | 'book'
  | 'book-package'
  | (string & {}) // "density:<key>" | "approx-each:<key>" | other pipeline-specific tags

export type GramsConfidence = 'high' | 'medium' | 'low'

export interface Ingredient {
  raw: string
  quantity: number | null
  quantity_text: string
  unit: string | null
  metric: string | null
  package_metric: string | null
  item: string
  prep: string | null
  optional: boolean
  grams: number | null
  grams_source: GramsSource | null
  grams_confidence: GramsConfidence | null
  weighable: boolean
  approx: boolean
  display: string
}

export interface IngredientGroup {
  name: string | null
  ingredients: Ingredient[]
}

export interface Recipe {
  id: string
  title: string
  source_book: string
  source_file: string
  authors: string[]
  servings: number | null
  servings_text: string | null
  time_text: string | null
  diet_tags: string[]
  headnote: string | null
  ingredient_groups: IngredientGroup[]
  steps: string[]
  notes: string[]
  nutrition: string | null
  ingredient_count: number
  weighable_count: number
  total_grams: number
  confidence: number
  warnings: string[]
  /** Public Supabase Storage URL, or null. Added by build-bundle.mjs. */
  image: string | null
  /** True when the extraction pipeline suspects this is a sub-recipe (sauce, crust, etc.) rather than a standalone dish. Added by build-bundle.mjs. */
  isComponent: boolean
  /** False when extraction found no method steps at all — a broken recipe, not just an incomplete one. Added by build-bundle.mjs. */
  hasSteps: boolean
}

export type SwipeDirection = 'left' | 'right' | 'down'

/** One swipe action. Repeatable per (user, recipe) now — recipes resurface, they aren't one-shot. */
export interface SwipeEvent {
  recipeId: string
  userId: string
  direction: SwipeDirection
  deckId: string
  swipedAt: string // ISO timestamp
}

/**
 * Materialized current state per (user, recipe) — what the deck and favorites
 * logic actually read. Starts at priority 5 on first swipe; right +1 and marks
 * favorited (sticky — never unset by a later left swipe); left -1; down or
 * priority <= 0 sets removedAt, which takes the recipe out of that user's deck
 * pool for good.
 */
export interface RecipePriority {
  userId: string
  recipeId: string
  priority: number
  favorited: boolean
  removedAt: string | null
  updatedAt: string
}

/** A named filter over the recipe pool — "New", "Everything", more later. */
export interface Deck {
  id: string
  label: string
  isEligible: (recipe: Recipe, priority: RecipePriority | undefined, tagSlugs: Set<string>) => boolean
}

/** Pipeline-computed grouping (scripts/tag-recipes.mjs) — see scripts/schema-recipe-tags.sql. */
export type TagCategory = 'time' | 'cuisine' | 'ingredient'

export interface RecipeTag {
  recipeId: string
  category: TagCategory
  tagSlug: string
  label: string
}

/** One line of the shared household shopping list (scripts/schema-shopping-list.sql). */
export interface ShoppingListItem {
  itemKey: string
  unitKey: string
  qtyTotal: number
  qtyNotes: string
  checked: boolean
  updatedAt: string
}

/** A recipe currently "in the plan" (scripts/schema-meal-plan.sql). */
export interface MealPlanEntry {
  recipeId: string
  addedAt: string
}

/**
 * Shared personal notes/edits for a recipe (scripts/schema-recipe-overrides.sql).
 * Empty ingredientsOverride/stepsOverride means "no edit — show the book's
 * original"; freeform one-item/step-per-line text otherwise.
 */
export interface RecipeOverride {
  recipeId: string
  notes: string
  ingredientsOverride: string
  stepsOverride: string
  updatedAt: string
}
