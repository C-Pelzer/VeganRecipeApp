import type { Recipe } from '../types/recipe'

// Book recipes keep the pipeline's plain id; ImportRecipeScreen/AddRecipeScreen
// prefix theirs (mapToRecipe.ts, buildManualRecipe.ts's callers) — that prefix
// is the only signal distinguishing the three, so it's read back here rather
// than adding a stored field.
export function provenanceLabel(recipe: Recipe): string | null {
  if (recipe.id.startsWith('manual-')) return 'Manually Added'
  if (recipe.id.startsWith('imported-')) return 'Imported'
  return null
}
