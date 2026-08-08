import type { Ingredient } from '../../types/recipe'

// Best-effort split of a free-text ingredient line (as scraped from a
// website's recipeIngredient array) into the same Ingredient shape the
// cookbook pipeline produces — see extract.py's parse_ingredient() for the
// original inspiration. Gram conversion is deliberately skipped (grams:
// null, weighable: false) since nothing in the UI requires it (see
// app/src/components/RecipeDetailModal.tsx, which falls back to `display`
// for any non-weighable ingredient) — only quantity/unit/item feed the
// shopping list (shoppingListMath.ts), and those don't need grams either.

const VULGAR_FRACTIONS: Record<string, string> = {
  '¼': '1/4',
  '½': '1/2',
  '¾': '3/4',
  '⅓': '1/3',
  '⅔': '2/3',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
}

const KNOWN_UNITS = new Set([
  'cup', 'cups', 'c',
  'tablespoon', 'tablespoons', 'tbsp', 'tbs',
  'teaspoon', 'teaspoons', 'tsp',
  'ounce', 'ounces', 'oz',
  'pound', 'pounds', 'lb', 'lbs',
  'gram', 'grams', 'g',
  'kilogram', 'kilograms', 'kg',
  'milliliter', 'milliliters', 'ml',
  'liter', 'liters', 'l',
  'pint', 'pints', 'pt',
  'quart', 'quarts', 'qt',
  'gallon', 'gallons', 'gal',
  'can', 'cans', 'jar', 'jars', 'package', 'packages', 'pkg',
  'clove', 'cloves', 'bunch', 'bunches', 'head', 'heads',
  'slice', 'slices', 'stalk', 'stalks', 'sprig', 'sprigs',
  'pinch', 'pinches', 'dash', 'dashes', 'handful', 'handfuls',
])

function quantityTokenValue(token: string): number | null {
  if (/^\d+\/\d+$/.test(token)) {
    const [n, d] = token.split('/')
    return Number(n) / Number(d)
  }
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token)
  if (VULGAR_FRACTIONS[token]) return quantityTokenValue(VULGAR_FRACTIONS[token])
  return null
}

function normalizeQuantityToken(token: string): string {
  return VULGAR_FRACTIONS[token] ?? token
}

function isQuantityToken(token: string): boolean {
  return quantityTokenValue(normalizeQuantityToken(token)) !== null
}

function isRangeToken(token: string): boolean {
  const parts = token.split(/[-–—]/)
  return parts.length === 2 && parts.every((p) => isQuantityToken(p))
}

export function parseIngredientLine(raw: string): Ingredient {
  const text = raw.trim()
  const optional = /\boptional\b/i.test(text)
  const tokens = text.split(/\s+/)

  let i = 0
  const quantityTokens: string[] = []
  if (tokens[i] && (isQuantityToken(tokens[i]) || isRangeToken(tokens[i]))) {
    quantityTokens.push(tokens[i])
    i++
    // Mixed number: "1" followed by "1/2".
    if (tokens[i] && isQuantityToken(tokens[i]) && /\//.test(tokens[i])) {
      quantityTokens.push(tokens[i])
      i++
    }
  }

  let unit: string | null = null
  if (quantityTokens.length > 0 && tokens[i] && KNOWN_UNITS.has(tokens[i].toLowerCase().replace(/\.$/, ''))) {
    unit = tokens[i].toLowerCase().replace(/\.$/, '')
    i++
  }

  const quantityText = quantityTokens.join(' ')
  const isRange = quantityTokens.length === 1 && isRangeToken(quantityTokens[0])
  let quantity: number | null = null
  if (!isRange && quantityTokens.length > 0) {
    quantity = quantityTokens.reduce((sum, t) => sum + (quantityTokenValue(normalizeQuantityToken(t)) ?? 0), 0)
  }

  const rest = tokens.slice(i).join(' ')
  const commaIndex = rest.indexOf(',')
  const item = (commaIndex === -1 ? rest : rest.slice(0, commaIndex)).trim() || text
  const prep = commaIndex === -1 ? null : rest.slice(commaIndex + 1).trim() || null

  return {
    raw: text,
    quantity,
    quantity_text: quantityText,
    unit,
    metric: null,
    package_metric: null,
    item,
    prep,
    optional,
    grams: null,
    grams_source: null,
    grams_confidence: null,
    weighable: false,
    approx: false,
    display: text,
  }
}
