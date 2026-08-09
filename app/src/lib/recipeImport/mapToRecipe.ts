import { parseIngredientLine } from './parseIngredientLine'
import {
  decodeHtmlEntities,
  findRecipeJsonLd,
  formatIsoDuration,
  normalizeAuthors,
  normalizeImageUrl,
  normalizeInstructions,
  normalizeServings,
} from './parseJsonLd'
import { generateId } from '../generateId'
import type { Recipe } from '../../types/recipe'

export interface ImportResult {
  recipe: Recipe
  warnings: string[]
}

// Some sites (e.g. ones proxying images through Cloudflare's resizer) emit a
// root-relative image URL in their JSON-LD instead of an absolute one — only
// valid resolved against the page's own origin, not on its own.
function resolveUrl(url: string, base: string): string | null {
  try {
    return new URL(url, base).href
  } catch {
    return null
  }
}

export function importRecipeFromHtml(html: string, sourceUrl: string): ImportResult | null {
  const jsonLd = findRecipeJsonLd(html)
  if (!jsonLd || !jsonLd.name) return null

  const warnings: string[] = []
  const { servings, servingsText } = normalizeServings(jsonLd.recipeYield)
  const rawImage = normalizeImageUrl(jsonLd.image)
  const image = rawImage ? resolveUrl(rawImage, sourceUrl) : null
  const timeText = formatIsoDuration(jsonLd.totalTime)
  const steps = normalizeInstructions(jsonLd.recipeInstructions)
  const ingredients = (jsonLd.recipeIngredient ?? []).map((line) =>
    parseIngredientLine(decodeHtmlEntities(line)),
  )

  if (!image) warnings.push('No image found on the page.')
  if (!timeText) warnings.push('No total time found.')
  if (ingredients.length === 0) warnings.push('No ingredients found — this page may not use a supported recipe format.')
  if (steps.length === 0) warnings.push('No steps found.')

  let hostname = 'web'
  try {
    hostname = new URL(sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    // sourceUrl already validated by the caller; this is just a display fallback.
  }

  const recipe: Recipe = {
    id: `imported-${generateId()}`,
    title: decodeHtmlEntities(jsonLd.name),
    source_book: hostname,
    source_file: sourceUrl,
    authors: normalizeAuthors(jsonLd.author),
    servings,
    servings_text: servingsText,
    time_text: timeText,
    diet_tags: [],
    headnote: typeof jsonLd.description === 'string' ? decodeHtmlEntities(jsonLd.description) : null,
    ingredient_groups: [{ name: null, ingredients }],
    steps,
    notes: [],
    nutrition: null,
    ingredient_count: ingredients.length,
    weighable_count: 0,
    total_grams: 0,
    confidence: 1,
    warnings,
    image,
    isComponent: false,
    hasSteps: steps.length > 0,
  }

  return { recipe, warnings }
}
