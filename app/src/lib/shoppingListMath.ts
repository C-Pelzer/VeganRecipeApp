import type { Recipe } from '../types/recipe'

// Ingredient.item is not normalized in the source data — real values look like
// "medium red onion" or "finely chopped red onion (optional)". Stripping
// parens/"optional" plus a loop of leading size/prep words merges those into
// "red onion" without merging red onion with yellow onion (still genuinely
// different ingredients). This is text normalization, not real ingredient
// identity matching — inconsistent phrasing (e.g. "scallion" vs "green onion")
// still won't merge.
const LEADING_STRIP_WORDS = [
  'extra-large',
  'extra large',
  'small',
  'medium',
  'large',
  'chopped',
  'diced',
  'minced',
  'sliced',
  'shredded',
  'grated',
  'crushed',
  'peeled',
  'cubed',
  'halved',
  'quartered',
  'finely',
  'roughly',
  'coarsely',
  'thinly',
]

export function normalizeItemKey(item: string): string {
  let s = item
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\boptional\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  let changed = true
  while (changed) {
    changed = false
    for (const word of LEADING_STRIP_WORDS) {
      if (s.startsWith(`${word} `) || s === word) {
        s = s.slice(word.length).trim()
        changed = true
      }
    }
  }

  return s || item.toLowerCase().trim()
}

const UNIT_SYNONYMS: Record<string, string> = {
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsp: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  cup: 'cup',
  cups: 'cup',
  ounce: 'oz',
  ounces: 'oz',
  oz: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lb: 'lb',
  lbs: 'lb',
  gram: 'g',
  grams: 'g',
  g: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kg: 'kg',
  milliliter: 'ml',
  milliliters: 'ml',
  ml: 'ml',
  liter: 'l',
  liters: 'l',
  l: 'l',
  can: 'can',
  cans: 'can',
  clove: 'clove',
  cloves: 'clove',
}

export function normalizeUnit(unit: string | null): string {
  if (!unit) return ''
  const key = unit.toLowerCase().trim()
  return UNIT_SYNONYMS[key] ?? key
}

const VAGUE_QUANTITY = /\b(to taste|pinch|dash|splash|handful|as needed)\b/i

// Ingredient.quantity is lossy (a range like "1 1/2–2 tbsp" parses to just 1)
// — reparse quantity_text directly instead, and return null (never a guess)
// for anything ambiguous so it's preserved as text rather than summed wrong.
export function parseCleanQuantity(quantityText: string): number | null {
  if (!quantityText) return null
  const text = quantityText.trim()
  if (/[-–—]/.test(text)) return null
  if (VAGUE_QUANTITY.test(text)) return null

  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])

  const fraction = text.match(/^(\d+)\/(\d+)$/)
  if (fraction) return Number(fraction[1]) / Number(fraction[2])

  const plain = text.match(/^(\d+(\.\d+)?)$/)
  if (plain) return Number(plain[1])

  return null
}

export interface QuantityDelta {
  itemKey: string
  unitKey: string
  qtyDelta: number
  notes: string[]
}

function dedupNotes(notes: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const note of notes) {
    const key = note.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(note.trim())
  }
  return result
}

export function computeDeltas(recipes: Recipe[]): Map<string, QuantityDelta> {
  const deltas = new Map<string, QuantityDelta>()

  for (const recipe of recipes) {
    for (const group of recipe.ingredient_groups) {
      for (const ingredient of group.ingredients) {
        const itemKey = normalizeItemKey(ingredient.item)
        const unitKey = normalizeUnit(ingredient.unit)
        const key = `${itemKey}::${unitKey}`
        const qty = parseCleanQuantity(ingredient.quantity_text)

        // quantity_text is null for garnish/topping-style ingredients with no
        // measured amount at all (e.g. "Crusty bread, for serving") despite
        // the field being typed as a plain string — guard rather than trust it.
        const note = qty === null && ingredient.quantity_text ? ingredient.quantity_text : null

        const existing = deltas.get(key)
        if (existing) {
          if (qty !== null) existing.qtyDelta += qty
          else if (note) existing.notes.push(note)
        } else {
          deltas.set(key, {
            itemKey,
            unitKey,
            qtyDelta: qty ?? 0,
            notes: note ? [note] : [],
          })
        }
      }
    }
  }

  for (const delta of deltas.values()) {
    delta.notes = dedupNotes(delta.notes)
  }

  return deltas
}

// A manually-typed shopping list entry, e.g. "3 napkins" or just "napkins".
// No unit parsing here (unlike Ingredient.unit) — manual entries always land
// in the plain-count bucket (unitKey ''), same as a bare-noun ingredient like
// avocado, so "avocado" typed by hand still merges with a recipe-derived line.
export function parseManualEntry(text: string): { itemKey: string; qty: number } {
  const trimmed = text.trim()
  const match = trimmed.match(/^(\d+(?:\.\d+)?|\d+\/\d+)\s+(.+)$/)
  if (match) {
    const qty = match[1].includes('/')
      ? (() => {
          const [n, d] = match[1].split('/')
          return Number(n) / Number(d)
        })()
      : Number(match[1])
    return { itemKey: normalizeItemKey(match[2]), qty }
  }
  return { itemKey: normalizeItemKey(trimmed), qty: 1 }
}

export function formatQuantity(qtyTotal: number, notes: string[]): string {
  const parts: string[] = []
  if (qtyTotal > 0) parts.push(String(Math.round(qtyTotal * 100) / 100))
  parts.push(...notes)
  return parts.length ? parts.join(' + ') : '1'
}

export function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function itemLabel(row: { itemKey: string; unitKey: string; qtyTotal: number; qtyNotes: string }): string {
  const notes = row.qtyNotes ? row.qtyNotes.split(';').filter(Boolean) : []
  const qty = formatQuantity(row.qtyTotal, notes)
  const unit = row.unitKey ? ` ${row.unitKey}` : ''
  return `${qty}${unit} ${titleCase(row.itemKey)}`
}
