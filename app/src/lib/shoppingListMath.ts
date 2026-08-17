import type { Recipe, ShoppingListItem } from '../types/recipe'

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
  'medium-sized',
  'medium sized',
  'small-sized',
  'large-sized',
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
    // Extraction sometimes truncates mid-parenthetical ("all-purpose flour
    // (for gluten-free"), which the balanced-paren strip above leaves behind
    // verbatim. Drop a trailing unclosed group too.
    .replace(/\([^)]*$/, ' ')
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

// A handful of "ingredients" in the extracted corpus are actually stray time
// strings that landed in the ingredient list ("about 25 minutes", "10
// minutes"). They're meaningless on a shopping list, so drop them at the point
// recipes are added rather than trying to filter them at render.
const JUNK_ITEM_PATTERNS = [
  /^(about |approximately |roughly )?[\d\s./–—-]*(minutes?|mins?|hours?|hrs?|seconds?|secs?)$/,
  /^[\d\s./]+$/,
]

export function isJunkItem(itemKey: string): boolean {
  const s = itemKey.trim().toLowerCase()
  if (!s) return true
  return JUNK_ITEM_PATTERNS.some((re) => re.test(s))
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
        if (isJunkItem(itemKey)) continue
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

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

// Quantities are summed across recipes, so they land on values no cook writes
// down — 0.33 cup, 2.25 tsp. Snap to the fractions a measuring spoon actually
// has. Ordered ascending; used for both exact matching and rounding up.
const NICE_FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
]

const EPSILON = 0.02

// Rounds *up* to the next measurable fraction rather than to the nearest one:
// on a shopping list, slightly too much is recoverable and slightly too little
// means a second trip.
export function formatMeasuredQuantity(qty: number): string {
  const whole = Math.floor(qty + EPSILON)
  const frac = qty - whole

  if (frac < EPSILON) return String(whole)

  const match =
    NICE_FRACTIONS.find(([value]) => Math.abs(frac - value) < EPSILON) ??
    NICE_FRACTIONS.find(([value]) => value > frac)

  // Above ⅞ with no nice fraction to round up into — carry to the next whole.
  if (!match) return String(whole + 1)
  return whole > 0 ? `${whole}${match[1]}` : match[1]
}

// Countable things with no unit ("1.5 red bell pepper") can't be bought in
// fractions, so these round up to whole items instead of showing a fraction.
export function formatCountQuantity(qty: number): string {
  return String(Math.max(1, Math.ceil(qty - EPSILON)))
}

// Units that read naturally in the plural. The abbreviations (tsp/tbsp/oz/lb/
// g/ml/kg/l) deliberately don't — recipe convention leaves them invariant.
const PLURALIZABLE_UNITS = new Set([
  'cup',
  'clove',
  'can',
  'head',
  'bunch',
  'rib',
  'stalk',
  'slice',
  'sprig',
  'pint',
  'quart',
  'handful',
  'bag',
  'jar',
  'package',
])

function formatUnit(unitKey: string, qty: number): string {
  if (!unitKey) return ''
  if (qty > 1 && PLURALIZABLE_UNITS.has(unitKey)) return `${unitKey}s`
  return unitKey
}

// Unit conversion, so the same ingredient arriving in tsp from one recipe and
// tbsp from another combines into one number instead of two list rows.
const UNIT_FAMILIES: Record<string, { family: string; inBase: number }> = {
  tsp: { family: 'volume-us', inBase: 1 },
  tbsp: { family: 'volume-us', inBase: 3 },
  cup: { family: 'volume-us', inBase: 48 },
  ml: { family: 'volume-metric', inBase: 1 },
  l: { family: 'volume-metric', inBase: 1000 },
  oz: { family: 'weight-us', inBase: 1 },
  lb: { family: 'weight-us', inBase: 16 },
  g: { family: 'weight-metric', inBase: 1 },
  kg: { family: 'weight-metric', inBase: 1000 },
}

interface AmountPart {
  unitKey: string
  qty: number
}

/**
 * Collapses parts into as few readable amounts as possible. Parts sharing a
 * unit family are summed and rendered in the largest unit that was actually
 * used, provided the total reaches half of it — so 0.75 cup + 1 tbsp reads
 * "⅞ cup" rather than "13 tbsp", but 2 tsp stays "2 tsp" instead of becoming
 * "⅔ tbsp". Parts in unrelated families (5 cloves + 1 tbsp garlic) can't be
 * combined and are joined with "+".
 */
export function formatAmounts(parts: AmountPart[]): string {
  const buckets = new Map<string, AmountPart[]>()
  for (const part of parts) {
    if (part.qty <= 0) continue
    const family = UNIT_FAMILIES[part.unitKey]?.family ?? `raw:${part.unitKey}`
    const bucket = buckets.get(family)
    if (bucket) bucket.push(part)
    else buckets.set(family, [part])
  }

  // Bare counts read first ("1 + 1 cup carrot", not "1 cup + 1 carrot") so a
  // row's leading number means the same thing everywhere in the list.
  const ordered = [...buckets.entries()].sort(
    (a, b) => Number(b[0] === 'raw:') - Number(a[0] === 'raw:'),
  )

  const rendered: string[] = []
  for (const [family, bucketParts] of ordered) {
    if (family.startsWith('raw:')) {
      // No conversion possible — sum same-unit parts and render directly.
      const unitKey = bucketParts[0].unitKey
      const total = bucketParts.reduce((sum, p) => sum + p.qty, 0)
      const qtyText = unitKey ? formatMeasuredQuantity(total) : formatCountQuantity(total)
      const unitText = formatUnit(unitKey, total)
      rendered.push(unitText ? `${qtyText} ${unitText}` : qtyText)
      continue
    }

    const totalInBase = bucketParts.reduce((sum, p) => sum + p.qty * UNIT_FAMILIES[p.unitKey].inBase, 0)
    const candidates = [...new Set(bucketParts.map((p) => p.unitKey))].sort(
      (a, b) => UNIT_FAMILIES[b].inBase - UNIT_FAMILIES[a].inBase,
    )
    const chosen =
      candidates.find((unit) => totalInBase / UNIT_FAMILIES[unit].inBase >= 0.5) ??
      candidates[candidates.length - 1]
    const qty = totalInBase / UNIT_FAMILIES[chosen].inBase
    rendered.push(`${formatMeasuredQuantity(qty)} ${formatUnit(chosen, qty)}`)
  }

  return rendered.join(' + ')
}

export function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Pantry classification
// ---------------------------------------------------------------------------

// Staples you check the cupboard for rather than buy by the measured amount —
// "2¼ tsp sea salt" is a true number and a useless shopping instruction. These
// render in their own section with no quantity at all.
//
// Deliberately conservative: a produce item misfiled here is a missed
// purchase, whereas a staple left in the buy list is only mild noise. Anything
// ambiguous stays out.
const NOT_PANTRY = [
  /^fresh\b/, // fresh basil/cilantro/thyme are produce, dried are pantry
  /\bstock\b/, // "vegetable stock or water" is a purchase, not a water check
  /\bbroth\b/,
  /\bbell pepper/,
  /\bjalape/,
  /\bpoblano\b/,
  /\bserrano\b/,
  /\bhabanero\b/,
  /\bchiles?\b/,
]

const PANTRY_PATTERNS = [
  /\bsalt\b/,
  /\bpepper(corns?)?\b/,
  /\boil\b/,
  /\bvinegar\b/,
  /\bwater\b/,
  /\bsugar\b/,
  /\bsweetener\b/,
  /\bagave\b/,
  /\bmaple syrup\b/,
  /\bflour\b/,
  /\bcornstarch\b/,
  /\bbaking (powder|soda)\b/,
  /\bvanilla\b/,
  /\bextract\b/,
  /\bcinnamon\b/,
  /\bcumin\b/,
  /\bpaprika\b/,
  /\bturmeric\b/,
  /\bcoriander\b/,
  /\bcardamom\b/,
  /\bnutmeg\b/,
  /\ballspice\b/,
  /\bcayenne\b/,
  /\bchili powder\b/,
  /\bchili flakes\b/,
  /\bred pepper flakes\b/,
  /\bcurry powder\b/,
  /\bgaram masala\b/,
  /\bgarlic powder\b/,
  /\bonion powder\b/,
  /\bbay (leaf|leaves)\b/,
  /\boregano\b/,
  /\bthyme\b/,
  /\brosemary\b/,
  /\bsage\b/,
  /\bsoy sauce\b/,
  /\btamari\b/,
  /\bcoconut aminos\b/,
  /\bnutritional yeast\b/,
  /\bcooking spray\b/,
]

export function isPantryStaple(itemKey: string): boolean {
  const s = itemKey.toLowerCase()
  if (NOT_PANTRY.some((re) => re.test(s))) return false
  return PANTRY_PATTERNS.some((re) => re.test(s))
}

// ---------------------------------------------------------------------------
// Aisle classification
// ---------------------------------------------------------------------------

// Groups the buy list roughly the way a store is walked, so you stop
// criss-crossing between produce and frozen. Unlike the pantry split, a
// misfiled item here is cheap — every aisle section renders expanded, so the
// item is still plainly visible, just under a slightly odd heading. That
// tolerance is why these patterns can be broader than PANTRY_PATTERNS.
//
// Order matters: the first matching rule wins, so the specific exceptions
// ("peanut butter" is not refrigerated, "frozen peas" is not produce) are
// checked before the broad category they'd otherwise fall into.
export const AISLE_ORDER = [
  'produce',
  'bakery',
  'dry',
  'canned',
  'refrigerated',
  'frozen',
  'other',
] as const

export type AisleKey = (typeof AISLE_ORDER)[number]

export const AISLE_LABELS: Record<AisleKey, string> = {
  produce: 'Produce',
  bakery: 'Bakery',
  dry: 'Grains, Beans & Baking',
  canned: 'Canned & Jarred',
  refrigerated: 'Refrigerated',
  frozen: 'Frozen',
  other: 'Other',
}

const AISLE_RULES: [AisleKey, RegExp][] = [
  ['frozen', /\bfrozen\b/],
  // Nut butters read as "butter" but live with the dry goods.
  ['dry', /\b(peanut|almond|cashew|sunflower|seed) butter\b/],
  // Canned coconut milk vs refrigerated almond milk — both match /milk/.
  ['canned', /\bcoconut milk\b/],
  // Extraction often leaves the packaging in the item name rather than the
  // unit ("can black beans", "can fire-roasted tomatoes"), which would
  // otherwise read as dry beans and fresh tomatoes. Word-bounded so
  // cannellini/canola/pecans don't match.
  ['canned', /\b(cans?|canned|jars?|jarred)\b/],
  ['canned', /\b(sauce|applesauce|paste|salsa|stock|broth|olives?|capers?|pickles?|jam|preserves)\b/],
  ['refrigerated', /\b(tofu|tempeh|seitan|milk|yogurt|cheese|mozzarella|cheddar|parmesan|cream|butter|dressing|hummus|miso|kimchi|sauerkraut)\b/],
  ['bakery', /\b(bread|tortillas?|pitas?|flatbreads?|buns?|rolls?|bagels?|naan|baguette|crusts?|dough)\b/],
  [
    'produce',
    /\b(onions?|garlic|shallots?|leeks?|scallions?|celery|carrots?|potatoes?|potato|yams?|tomatoes?|tomato|cucumbers?|zucchini|squash|pumpkin|eggplant|broccoli|cauliflower|cabbage|kale|spinach|lettuce|romaine|arugula|chard|collards?|bok choy|peppers?|mushrooms?|avocados?|avocado|lemons?|lemon|limes?|lime|oranges?|apples?|bananas?|berries|berry|strawberries|blueberries|raspberries|mango|pineapple|grapes?|pears?|peaches?|melon|ginger|cilantro|parsley|basil|mint|dill|chives|corn|peas|green beans?|asparagus|beets?|radish|turnips?|parsnips?|fennel|sprouts|greens|herbs?)\b/,
  ],
  [
    'dry',
    /\b(rice|pasta|noodles?|quinoa|oats|lentils?|chickpeas?|beans?|cashews?|almonds?|walnuts?|pecans?|peanuts?|nuts?|seeds?|chia|flax|sesame|breadcrumbs?|cocoa|chocolate|raisins?|dates?|cornmeal|crackers?|chips?|couscous|barley|farro)\b/,
  ],
]

export function classifyAisle(itemKey: string, unitKeys: string[]): AisleKey {
  // The unit is sometimes the only signal the item is canned — "fire-roasted
  // tomatoes" reads as produce until you notice it's measured in cans. Matched
  // by pattern, not equality: unnormalized units like "14-ounce can" are
  // common and an exact 'can' comparison silently misses them.
  if (unitKeys.some((u) => /\bcans?\b/.test(u))) return 'canned'

  const s = itemKey.toLowerCase()
  for (const [aisle, pattern] of AISLE_RULES) {
    if (pattern.test(s)) return aisle
  }
  return 'other'
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * One display row: every stored row sharing an itemKey, merged. Rows stay
 * keyed by (itemKey, unitKey) in Supabase — this collapse is purely for
 * reading, so `rows` carries the originals back for checkbox writes.
 */
export interface MergedShoppingItem {
  itemKey: string
  label: string
  amount: string
  notes: string[]
  checked: boolean
  isPantry: boolean
  aisle: AisleKey
  rows: ShoppingListItem[]
}

export interface AisleSection {
  key: AisleKey
  label: string
  items: MergedShoppingItem[]
}

function mergeRows(itemKey: string, rows: ShoppingListItem[]): MergedShoppingItem {
  const notes = dedupNotes(rows.flatMap((r) => (r.qtyNotes ? r.qtyNotes.split(';').filter(Boolean) : [])))
  const isPantry = isPantryStaple(itemKey)
  return {
    itemKey,
    label: titleCase(itemKey),
    // Pantry staples are a cupboard check, not a purchase amount — the number
    // is suppressed rather than computed and hidden.
    amount: isPantry ? '' : formatAmounts(rows.map((r) => ({ unitKey: r.unitKey, qty: r.qtyTotal }))),
    notes: isPantry ? [] : notes,
    checked: rows.every((r) => r.checked),
    isPantry,
    aisle: classifyAisle(
      itemKey,
      rows.map((r) => r.unitKey),
    ),
    rows,
  }
}

export function groupShoppingList(items: ShoppingListItem[]): {
  sections: AisleSection[]
  pantry: MergedShoppingItem[]
  total: number
  checkedCount: number
} {
  const byItem = new Map<string, ShoppingListItem[]>()
  for (const item of items) {
    const bucket = byItem.get(item.itemKey)
    if (bucket) bucket.push(item)
    else byItem.set(item.itemKey, [item])
  }

  const merged = [...byItem.entries()].map(([itemKey, rows]) => mergeRows(itemKey, rows))
  // Checked items sink within their own aisle rather than to the bottom of the
  // list, so a ticked-off row stays next to the shelf it came from.
  const sort = (a: MergedShoppingItem, b: MergedShoppingItem) =>
    Number(a.checked) - Number(b.checked) || a.label.localeCompare(b.label)

  const toBuy = merged.filter((m) => !m.isPantry)
  const sections = AISLE_ORDER.map((key) => ({
    key,
    label: AISLE_LABELS[key],
    items: toBuy.filter((m) => m.aisle === key).sort(sort),
  })).filter((section) => section.items.length > 0)

  return {
    sections,
    pantry: merged.filter((m) => m.isPantry).sort(sort),
    total: merged.length,
    checkedCount: merged.filter((m) => m.checked).length,
  }
}
