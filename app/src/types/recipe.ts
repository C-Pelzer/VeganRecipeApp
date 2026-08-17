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

/** A named filter over the recipe pool — "New", "Everything", or a persisted SwipeDeckSummary's membership. */
export interface Deck {
  id: string
  label: string
  isEligible: (recipe: Recipe, priority: RecipePriority | undefined) => boolean
}

/** Pipeline-computed grouping (scripts/tag-recipes.mjs) — see scripts/schema-recipe-tags.sql. */
// Must match the CHECK constraints on recipe_tags.category and
// swipe_decks.category — see scripts/schema-recipe-tags-categories.sql and
// scripts/schema-swipe-decks-categories.sql.
export type TagCategory =
  | 'time'
  | 'cuisine'
  | 'ingredient'
  | 'course'
  | 'book'
  | 'diet'
  | 'effort'
  | 'season'

export interface RecipeTag {
  recipeId: string
  category: TagCategory
  tagSlug: string
  label: string
}

/**
 * A household member's edit to a recipe's tags, layered on top of the
 * pipeline-computed RecipeTag rows (scripts/schema-recipe-tag-overrides.sql).
 * 'remove' drops an otherwise-auto tag; 'add' introduces one that isn't.
 */
export interface RecipeTagOverride {
  recipeId: string
  category: TagCategory
  tagSlug: string
  label: string
  action: 'add' | 'remove'
  updatedAt: string
}

/**
 * A persisted, bounded (<=40 recipes) swipe deck (scripts/schema-swipe-decks.sql).
 * 'auto' decks are one per tag, built by scripts/build-swipe-decks.mjs;
 * 'manual' decks are hand-picked in the Catalog deck builder.
 */
export interface SwipeDeckSummary {
  id: string
  label: string
  source: 'auto' | 'manual'
  category: TagCategory | null
  tagSlug: string | null
  /** Profile id, or null for an auto deck (no human creator). */
  createdBy: string | null
  createdAt: string
}

/** An explicit "send this deck to another household member" record. */
export interface SwipeDeckShare {
  deckId: string
  sharedWith: string
  sharedBy: string
  sharedAt: string
  seenAt: string | null
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

/**
 * A user-added "I made this" photo, layered alongside (not replacing) the
 * recipe's original book/import photo (scripts/schema-recipe-photos.sql).
 */
export interface RecipePhoto {
  id: string
  recipeId: string
  photoUrl: string
  addedBy: string
  addedAt: string
}

export type MealType = 'breakfast' | 'lunch' | 'dinner'

/** One filled calendar slot — a recipe + assigned person on a given date (scripts/schema-meal-calendar.sql). */
export interface MealCalendarEntry {
  entryDate: string // YYYY-MM-DD
  mealType: MealType
  recipeId: string
  assignedTo: string
  updatedAt: string
}
