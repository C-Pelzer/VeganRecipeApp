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
  /** Relative path under /public, e.g. "images/recipes/<id>.jpg", or null. Added by build-bundle.mjs. */
  image: string | null
  /** True when the extraction pipeline suspects this is a sub-recipe (sauce, crust, etc.) rather than a standalone dish. Added by build-bundle.mjs. */
  isComponent: boolean
}

export type SwipeDirection = 'left' | 'right'

export interface Swipe {
  recipeId: string
  userId: string
  direction: SwipeDirection
  swipedAt: string // ISO timestamp
}
