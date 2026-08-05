import type { RecipePriority, SwipeDirection } from '../../types/recipe'
import type { SyncStore } from './types'

const STORAGE_KEY = 'recipe-app:priorities'

function readAll(): RecipePriority[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as RecipePriority[]
  } catch {
    return []
  }
}

function writeAll(priorities: RecipePriority[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(priorities))
}

/**
 * Pure priority-arithmetic, mirroring the `apply_swipe` Postgres function so
 * offline swipes behave identically once replayed against the real thing.
 */
export function nextPriority(
  current: RecipePriority | undefined,
  userId: string,
  recipeId: string,
  direction: SwipeDirection,
): RecipePriority {
  const base: RecipePriority = current ?? {
    userId,
    recipeId,
    priority: 5,
    favorited: false,
    removedAt: null,
    updatedAt: new Date().toISOString(),
  }
  const now = new Date().toISOString()

  if (direction === 'right') {
    return { ...base, priority: base.priority + 1, favorited: true, updatedAt: now }
  }
  if (direction === 'left') {
    const priority = base.priority - 1
    return {
      ...base,
      priority,
      removedAt: base.removedAt ?? (priority <= 0 ? now : null),
      updatedAt: now,
    }
  }
  // 'down'
  return { ...base, removedAt: base.removedAt ?? now, updatedAt: now }
}

export class LocalStore implements SyncStore {
  async getPriorities(userId: string): Promise<RecipePriority[]> {
    return readAll().filter((p) => p.userId === userId)
  }

  async applySwipe(
    userId: string,
    recipeId: string,
    direction: SwipeDirection,
    _deckId: string,
  ): Promise<RecipePriority> {
    const all = readAll()
    const current = all.find((p) => p.userId === userId && p.recipeId === recipeId)
    const updated = nextPriority(current, userId, recipeId, direction)
    await this.setPriority(updated)
    return updated
  }

  /** Overwrites the cache with an authoritative value (e.g. from the server) — not arithmetic. */
  async setPriority(priority: RecipePriority): Promise<void> {
    const without = readAll().filter(
      (p) => !(p.userId === priority.userId && p.recipeId === priority.recipeId),
    )
    writeAll([...without, priority])
  }
}
