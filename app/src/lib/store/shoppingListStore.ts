import { supabase } from '../supabaseClient'
import { computeDeltas, parseManualEntry, type QuantityDelta } from '../shoppingListMath'
import { getCurrentHouseholdId } from '../auth'
import type { Recipe, ShoppingListItem } from '../../types/recipe'

interface ShoppingListRow {
  item_key: string
  unit_key: string
  qty_total: number
  qty_notes: string
  checked: boolean
  updated_at: string
  household_id?: string
}

function rowToItem(row: ShoppingListRow): ShoppingListItem {
  return {
    itemKey: row.item_key,
    unitKey: row.unit_key,
    qtyTotal: row.qty_total,
    qtyNotes: row.qty_notes,
    checked: row.checked,
    updatedAt: row.updated_at,
  }
}

function roundQty(qty: number): number {
  return Math.round(qty * 10000) / 10000
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

async function getItems(): Promise<ShoppingListItem[]> {
  const { data, error } = await supabase.from('shopping_list_items').select('*')
  if (error) throw error
  return (data ?? []).map(rowToItem)
}

// Fetches the full table (small — realistically dozens of rows) to compute
// correct merged totals, but only upserts the rows this addition actually
// changed, so an in-flight checkbox toggle from the other phone can't be
// clobbered by a stale full-table replace. Shared by addRecipes and
// addManualItem — both just need to produce a delta map first.
async function mergeDeltas(deltas: Map<string, QuantityDelta>): Promise<void> {
  if (deltas.size === 0) return

  const existing = await getItems()
  const existingByKey = new Map(existing.map((item) => [`${item.itemKey}::${item.unitKey}`, item]))

  const changedRows: ShoppingListRow[] = []
  for (const [key, delta] of deltas) {
    const current = existingByKey.get(key)
    const qtyNotes = dedupNotes([
      ...(current?.qtyNotes ? current.qtyNotes.split(';').filter(Boolean) : []),
      ...delta.notes,
    ])
    changedRows.push({
      item_key: delta.itemKey,
      unit_key: delta.unitKey,
      qty_total: roundQty((current?.qtyTotal ?? 0) + delta.qtyDelta),
      qty_notes: qtyNotes.join(';'),
      // A checked-off item getting a fresh need should reopen. Re-adding the
      // same recipe twice will double-count it — no per-recipe source
      // tracking, accepted as a known limitation at this scale.
      checked: false,
      updated_at: new Date().toISOString(),
      household_id: getCurrentHouseholdId(),
    })
  }

  const { error } = await supabase.from('shopping_list_items').upsert(changedRows)
  if (error) throw error
}

async function addRecipes(recipes: Recipe[]): Promise<void> {
  await mergeDeltas(computeDeltas(recipes))
}

// Free-typed items (e.g. "3 napkins", or just "napkins") merge through the
// same path as recipe ingredients — no unit is parsed, so a plain-count entry
// like "avocado" will bump an existing recipe-derived avocado line rather
// than creating a duplicate.
async function addManualItem(itemText: string): Promise<void> {
  const trimmed = itemText.trim()
  if (!trimmed) return
  const { itemKey, qty } = parseManualEntry(trimmed)
  await mergeDeltas(new Map([[`${itemKey}::`, { itemKey, unitKey: '', qtyDelta: qty, notes: [] }]]))
}

// Same computeDeltas() used to add, run in reverse — Recipe data is static, so
// a recipe's contribution can always be re-derived rather than needing to be
// stored up front. qty_notes (freeform "to taste"/range strings) are a deduped
// set, not a per-recipe multiset — there's no reliable way to know whether
// another still-planned recipe also needs a given note, so notes are left
// untouched here; a row only gets deleted once its numeric total is zero AND
// it has no lingering notes.
async function subtractRecipes(recipes: Recipe[]): Promise<void> {
  const deltas = computeDeltas(recipes)
  if (deltas.size === 0) return

  const existing = await getItems()
  const existingByKey = new Map(existing.map((item) => [`${item.itemKey}::${item.unitKey}`, item]))

  const rowsToUpsert: ShoppingListRow[] = []
  const keysToDelete: { itemKey: string; unitKey: string }[] = []

  for (const [key, delta] of deltas) {
    const current = existingByKey.get(key)
    if (!current) continue // nothing to subtract from (e.g. shopping list was already cleared)

    const nextTotal = Math.max(0, roundQty(current.qtyTotal - delta.qtyDelta))
    if (nextTotal <= 0 && !current.qtyNotes) {
      keysToDelete.push({ itemKey: delta.itemKey, unitKey: delta.unitKey })
    } else {
      rowsToUpsert.push({
        item_key: current.itemKey,
        unit_key: current.unitKey,
        qty_total: nextTotal,
        qty_notes: current.qtyNotes,
        checked: current.checked,
        updated_at: new Date().toISOString(),
        household_id: getCurrentHouseholdId(),
      })
    }
  }

  if (rowsToUpsert.length) {
    const { error } = await supabase.from('shopping_list_items').upsert(rowsToUpsert)
    if (error) throw error
  }
  for (const k of keysToDelete) {
    const { error } = await supabase
      .from('shopping_list_items')
      .delete()
      .eq('item_key', k.itemKey)
      .eq('unit_key', k.unitKey)
    if (error) throw error
  }
}

async function setChecked(itemKey: string, unitKey: string, checked: boolean): Promise<void> {
  const { error } = await supabase
    .from('shopping_list_items')
    .update({ checked, updated_at: new Date().toISOString() })
    .eq('item_key', itemKey)
    .eq('unit_key', unitKey)
  if (error) throw error
}

// The UI collapses every unit variant of an ingredient into one row (5 cloves
// + 1 tbsp garlic), so one checkbox can own several stored rows.
async function setCheckedMany(
  keys: { itemKey: string; unitKey: string }[],
  checked: boolean,
): Promise<void> {
  await Promise.all(keys.map((k) => setChecked(k.itemKey, k.unitKey, checked)))
}

// Removes one ingredient outright (all its unit variants). Unlike
// subtractRecipes this is unconditional — it's the "I don't need this, stop
// showing it to me" action, not a recalculation, so it deletes rather than
// decrementing toward zero. Re-adding a recipe that wants the item will bring
// it back, same as any other add.
async function removeItem(itemKey: string, unitKeys: string[]): Promise<void> {
  for (const unitKey of unitKeys) {
    const { error } = await supabase
      .from('shopping_list_items')
      .delete()
      .eq('item_key', itemKey)
      .eq('unit_key', unitKey)
    if (error) throw error
  }
}

async function clearAll(): Promise<void> {
  const { error } = await supabase.from('shopping_list_items').delete().not('item_key', 'is', null)
  if (error) throw error
}

export const shoppingListStore = {
  getItems,
  addRecipes,
  addManualItem,
  subtractRecipes,
  setChecked,
  setCheckedMany,
  removeItem,
  clearAll,
}
