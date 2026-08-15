import { parseIngredientLine } from './parseIngredientLine'
import {
  cleanText,
  findFallbackImage,
  findFallbackTitle,
  formatIsoDuration,
  normalizeAuthors,
  normalizeImageUrl,
  normalizeInstructions,
  normalizeServings,
  parseRecipePage,
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
  const parsed = parseRecipePage(html, sourceUrl)
  if (!parsed) return null
  const { jsonLd, graphById, doc } = parsed

  const warnings: string[] = []

  // A missing/blank JSON-LD name used to abort the import outright, even though
  // the page names the recipe in og:title, <h1>, and its own slug.
  const title = cleanText(jsonLd.name) || findFallbackTitle(doc, sourceUrl)
  if (!title) return null
  if (!cleanText(jsonLd.name)) warnings.push('Recipe name was missing — took the title from the page instead.')

  const { servings, servingsText } = normalizeServings(jsonLd.recipeYield)

  const rawImage = normalizeImageUrl(jsonLd.image, graphById) ?? findFallbackImage(doc)
  const image = rawImage ? resolveUrl(rawImage, sourceUrl) : null

  const timeText = formatIsoDuration(jsonLd.totalTime)
  const steps = normalizeInstructions(jsonLd.recipeInstructions)
  const ingredients = (jsonLd.recipeIngredient ?? []).map((line) => parseIngredientLine(cleanText(line)))

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
    title,
    source_book: hostname,
    source_file: sourceUrl,
    authors: normalizeAuthors(jsonLd.author),
    servings,
    servings_text: servingsText,
    time_text: timeText,
    diet_tags: [],
    headnote: cleanText(jsonLd.description) || null,
    ingredient_groups: [{ name: null, ingredients }],
    steps,
    notes: [],
    nutrition: null,
    ingredient_count: ingredients.length,
    weighable_count: 0,
    total_grams: 0,
    // Best-effort scrape — reflect how much actually came through rather than
    // claiming full confidence on every page the way this used to.
    confidence: Math.max(0.2, Number((1 - 0.15 * warnings.length).toFixed(2))),
    warnings,
    image,
    isComponent: false,
    hasSteps: steps.length > 0,
  }

  return { recipe, warnings }
}
