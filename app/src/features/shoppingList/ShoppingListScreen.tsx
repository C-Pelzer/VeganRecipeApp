import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { groupShoppingList, type MergedShoppingItem } from '../../lib/shoppingListMath'
import { shoppingListStore } from '../../lib/store/shoppingListStore'
import type { ShoppingListItem } from '../../types/recipe'

interface ShoppingListScreenProps {
  onOpenMenu: () => void
}

export function ShoppingListScreen({ onOpenMenu }: ShoppingListScreenProps) {
  const [items, setItems] = useState<ShoppingListItem[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [newItemText, setNewItemText] = useState('')
  const [addingItem, setAddingItem] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pantryOpen, setPantryOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    shoppingListStore
      .getItems()
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const { sections, pantry, total, checkedCount } = useMemo(
    () => groupShoppingList(items ?? []),
    [items],
  )

  // One checkbox can own several stored rows (every unit variant of the same
  // ingredient), so the optimistic update and its revert both work over the
  // whole set rather than a single key.
  function toggleChecked(merged: MergedShoppingItem) {
    const nextChecked = !merged.checked
    const affected = new Set(merged.rows.map((r) => `${r.itemKey}::${r.unitKey}`))
    const previous = new Map(merged.rows.map((r) => [`${r.itemKey}::${r.unitKey}`, r.checked]))

    setItems(
      (current) =>
        current?.map((i) =>
          affected.has(`${i.itemKey}::${i.unitKey}`) ? { ...i, checked: nextChecked } : i,
        ) ?? current,
    )

    shoppingListStore
      .setCheckedMany(
        merged.rows.map((r) => ({ itemKey: r.itemKey, unitKey: r.unitKey })),
        nextChecked,
      )
      .catch(() => {
        setActionError("Couldn't save that — check your connection.")
        // Failed to persist — put every affected row back where it was.
        setItems(
          (current) =>
            current?.map((i) => {
              const key = `${i.itemKey}::${i.unitKey}`
              return affected.has(key) ? { ...i, checked: previous.get(key) ?? i.checked } : i
            }) ?? current,
        )
      })
  }

  function removeItem(merged: MergedShoppingItem) {
    const removed = merged.rows
    setActionError(null)
    setItems((current) => current?.filter((i) => i.itemKey !== merged.itemKey) ?? current)

    shoppingListStore
      .removeItem(
        merged.itemKey,
        merged.rows.map((r) => r.unitKey),
      )
      .catch(() => {
        setActionError(`Couldn't remove ${merged.label}.`)
        setItems((current) => (current ? [...current, ...removed] : current))
      })
  }

  function handleClear() {
    setConfirmingClear(false)
    shoppingListStore
      .clearAll()
      .then(() => setItems([]))
      .catch(() => setActionError("Couldn't clear the list."))
  }

  function handleAddItem(e: FormEvent) {
    e.preventDefault()
    const text = newItemText.trim()
    if (!text) return
    setAddingItem(true)
    setActionError(null)
    shoppingListStore
      .addManualItem(text)
      .then(() => shoppingListStore.getItems())
      .then((data) => {
        setItems(data)
        setNewItemText('')
      })
      .catch(() => setActionError(`Couldn't add "${text}".`))
      // Without this the button stays disabled forever on any failure.
      .finally(() => setAddingItem(false))
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load the shopping list. Try reloading.
      </div>
    )
  }

  if (!items) {
    return (
      <div className="flex h-full items-center justify-center text-white/50">
        Loading shopping list…
      </div>
    )
  }

  function renderRow(merged: MergedShoppingItem) {
    return (
      <div key={merged.itemKey} className="flex items-center gap-2 rounded-xl bg-neutral-900 pr-1">
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 p-3">
          <input
            type="checkbox"
            checked={merged.checked}
            onChange={() => toggleChecked(merged)}
            className="h-5 w-5 shrink-0 accent-emerald-500"
          />
          <span className={`min-w-0 flex-1 ${merged.checked ? 'text-white/40 line-through' : 'text-white'}`}>
            {merged.amount ? <span className="font-semibold tabular-nums">{merged.amount} </span> : null}
            {merged.label}
            {merged.notes.length > 0 ? (
              <span className="block text-sm text-white/40">{merged.notes.join(' · ')}</span>
            ) : null}
          </span>
        </label>
        <button
          type="button"
          aria-label={`Remove ${merged.label}`}
          onClick={() => removeItem(merged)}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-lg leading-none text-white/25"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="flex flex-col items-center leading-tight">
          <span className="font-medium text-white">Shopping List</span>
          {total > 0 && (
            <span className="text-xs text-white/40">
              {checkedCount} of {total} done
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          disabled={items.length === 0}
          className="text-sm font-medium text-rose-400 disabled:text-white/20"
        >
          Clear
        </button>
      </div>

      <form onSubmit={handleAddItem} className="mb-3 flex gap-2">
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          placeholder="Add an item…"
          className="flex-1 rounded-xl bg-neutral-900 px-3 py-2 text-base text-white placeholder:text-white/40"
        />
        <button
          type="submit"
          disabled={addingItem || !newItemText.trim()}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {actionError && (
        <div className="mb-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {actionError}
        </div>
      )}

      {total === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-white/60">
          Nothing here yet — add recipes from Favorites, or add an item above.
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.key} className="space-y-2">
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-white/40">
                {section.label} · {section.items.length}
              </h2>
              {section.items.map(renderRow)}
            </div>
          ))}

          {pantry.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setPantryOpen((open) => !open)}
                className="flex min-h-11 w-full items-center justify-between rounded-xl bg-neutral-900/60 px-3 text-left text-sm text-white/60"
              >
                <span>Pantry check · {pantry.length}</span>
                <span aria-hidden="true">{pantryOpen ? '▾' : '▸'}</span>
              </button>
              {pantryOpen && <div className="mt-2 space-y-2">{pantry.map(renderRow)}</div>}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingClear}
        title="Clear shopping list?"
        message={`This removes all ${total} item${total === 1 ? '' : 's'}.`}
        confirmLabel="Clear"
        onConfirm={handleClear}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  )
}
