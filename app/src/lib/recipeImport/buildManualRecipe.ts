import { parseIngredientLine } from './parseIngredientLine'
import type { Recipe } from '../../types/recipe'

export interface ManualRecipeFields {
  title: string
  sourceBook: string
  servingsText: string
  timeText: string
  headnote: string
  ingredientLines: string[]
  stepLines: string[]
  image: string | null
}

// Same shape mapToRecipe.ts builds from scraped JSON-LD, but every field
// comes straight from a form instead of a parser — so the pipeline-only
// fields (diet_tags, notes, nutrition, weighable_count, total_grams,
// confidence, warnings) get the same "nothing to report" defaults
// mapToRecipe.ts uses, since a human typing a recipe never produces them.
export function buildManualRecipe(id: string, fields: ManualRecipeFields): Recipe {
  const ingredients = fields.ingredientLines.map(parseIngredientLine)
  const steps = fields.stepLines

  return {
    id,
    title: fields.title,
    source_book: fields.sourceBook || 'My Recipes',
    source_file: 'manual',
    authors: [],
    servings: null,
    servings_text: fields.servingsText || null,
    time_text: fields.timeText || null,
    diet_tags: [],
    headnote: fields.headnote || null,
    ingredient_groups: [{ name: null, ingredients }],
    steps,
    notes: [],
    nutrition: null,
    ingredient_count: ingredients.length,
    weighable_count: 0,
    total_grams: 0,
    confidence: 1,
    warnings: [],
    image: fields.image,
    isComponent: false,
    hasSteps: steps.length > 0,
  }
}
