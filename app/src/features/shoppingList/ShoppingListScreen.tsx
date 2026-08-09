import { useEffect, useState, type FormEvent } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { itemLabel } from '../../lib/shoppingListMath'
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

  function toggleChecked(item: ShoppingListItem) {
    const nextChecked = !item.checked
    setItems(
      (current) =>
        current?.map((i) =>
          i.itemKey === item.itemKey && i.unitKey === item.unitKey ? { ...i, checked: nextChecked } : i,
        ) ?? current,
    )
    shoppingListStore.setChecked(item.itemKey, item.unitKey, nextChecked).catch(() => {
      // Optimistic update failed to persist — revert so the UI matches Supabase.
      setItems(
        (current) =>
          current?.map((i) =>
            i.itemKey === item.itemKey && i.unitKey === item.unitKey ? { ...i, checked: item.checked } : i,
          ) ?? current,
      )
    })
  }

  function handleClear() {
    setConfirmingClear(false)
    shoppingListStore.clearAll().then(() => setItems([]))
  }

  function handleAddItem(e: FormEvent) {
    e.preventDefault()
    const text = newItemText.trim()
    if (!text) return
    setAddingItem(true)
    shoppingListStore
      .addManualItem(text)
      .then(() => shoppingListStore.getItems())
      .then((data) => {
        setItems(data)
        setNewItemText('')
        setAddingItem(false)
      })
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

  const sorted = items
    .slice()
    .sort((a, b) => Number(a.checked) - Number(b.checked) || a.itemKey.localeCompare(b.itemKey))

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Shopping List</span>
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
          className="flex-1 rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-white/40"
        />
        <button
          type="submit"
          disabled={addingItem || !newItemText.trim()}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {sorted.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-white/60">
          Nothing here yet — add recipes from Favorites, or add an item above.
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {sorted.map((item) => (
            <label
              key={`${item.itemKey}::${item.unitKey}`}
              className="flex items-center gap-3 rounded-xl bg-neutral-900 p-3"
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggleChecked(item)}
                className="h-5 w-5 shrink-0 accent-emerald-500"
              />
              <span className={item.checked ? 'text-white/40 line-through' : 'text-white'}>
                {itemLabel(item)}
              </span>
            </label>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmingClear}
        title="Clear shopping list?"
        message={`This removes all ${items.length} item${items.length === 1 ? '' : 's'}.`}
        confirmLabel="Clear"
        onConfirm={handleClear}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  )
}
