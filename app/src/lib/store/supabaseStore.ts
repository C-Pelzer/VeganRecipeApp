import { supabase } from '../supabaseClient'
import { fetchAllRows } from '../fetchAllRows'
import { LocalStore } from './localStore'
import type { SyncStore } from './types'
import type { RecipePriority, SwipeDirection } from '../../types/recipe'

const PENDING_KEY = 'recipe-app:pendingSwipes'
const PENDING_UNFAVORITE_KEY = 'recipe-app:pendingUnfavorites'

interface PendingSwipe {
  userId: string
  recipeId: string
  direction: SwipeDirection
  deckId: string
}

interface PendingUnfavorite {
  userId: string
  recipeId: string
}

interface PriorityRow {
  user_id: string
  recipe_id: string
  priority: number
  favorited: boolean
  removed_at: string | null
  updated_at: string
}

function rowToPriority(row: PriorityRow): RecipePriority {
  return {
    userId: row.user_id,
    recipeId: row.recipe_id,
    priority: row.priority,
    favorited: row.favorited,
    removedAt: row.removed_at,
    updatedAt: row.updated_at,
  }
}

function readPending(): PendingSwipe[] {
  const raw = localStorage.getItem(PENDING_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as PendingSwipe[]
  } catch {
    return []
  }
}

function writePending(pending: PendingSwipe[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

function readPendingUnfavorites(): PendingUnfavorite[] {
  const raw = localStorage.getItem(PENDING_UNFAVORITE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as PendingUnfavorite[]
  } catch {
    return []
  }
}

function writePendingUnfavorites(pending: PendingUnfavorite[]) {
  localStorage.setItem(PENDING_UNFAVORITE_KEY, JSON.stringify(pending))
}

/**
 * Supabase-backed sync via the `apply_swipe` RPC (does the priority
 * arithmetic atomically server-side, so two devices hitting the same row
 * can't race). The local store underneath serves two purposes: an offline
 * read cache, and a durable queue of swipe *actions* (not results) recorded
 * while offline, replayed through the same RPC once back online — a swipe
 * is never lost to a dropped connection, just delayed in reaching the other
 * phone.
 */
export class SupabaseStore implements SyncStore {
  private cache = new LocalStore()

  private async callApplySwipe(swipe: PendingSwipe): Promise<RecipePriority | null> {
    const { data, error } = await supabase.rpc('apply_swipe', {
      p_user_id: swipe.userId,
      p_recipe_id: swipe.recipeId,
      p_direction: swipe.direction,
      p_deck_id: swipe.deckId,
    })
    if (error) {
      console.warn('apply_swipe RPC failed', error)
      return null
    }
    return rowToPriority(data as PriorityRow)
  }

  private async flushPending() {
    const pending = readPending()
    if (!pending.length) return
    const stillPending: PendingSwipe[] = []
    for (const swipe of pending) {
      const result = await this.callApplySwipe(swipe)
      if (!result) stillPending.push(swipe)
    }
    writePending(stillPending)
  }

  private async callUnfavorite(userId: string, recipeId: string): Promise<boolean> {
    const { error } = await supabase
      .from('recipe_priority')
      .update({ favorited: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('recipe_id', recipeId)
    if (error) console.warn('unfavorite update failed', error)
    return !error
  }

  private async flushPendingUnfavorites() {
    const pending = readPendingUnfavorites()
    if (!pending.length) return
    const stillPending: PendingUnfavorite[] = []
    for (const u of pending) {
      const ok = await this.callUnfavorite(u.userId, u.recipeId)
      if (!ok) stillPending.push(u)
    }
    writePendingUnfavorites(stillPending)
  }

  async getPriorities(userId: string): Promise<RecipePriority[]> {
    await this.flushPending()
    await this.flushPendingUnfavorites()
    try {
      // Paginated: with 4800+ recipes in the pool, a household member who's
      // swiped through more than 1000 of them would otherwise silently lose
      // the rest to Supabase's default per-request row cap.
      const data = await fetchAllRows<PriorityRow>((from, to) =>
        supabase.from('recipe_priority').select('*').eq('user_id', userId).range(from, to),
      )
      const priorities = data.map(rowToPriority)
      for (const p of priorities) {
        await this.cache.setPriority(p)
      }
      return priorities
    } catch (err) {
      console.warn('Supabase fetch failed, falling back to local cache', err)
      return this.cache.getPriorities(userId)
    }
  }

  async applySwipe(
    userId: string,
    recipeId: string,
    direction: SwipeDirection,
    deckId: string,
  ): Promise<RecipePriority> {
    // Optimistic local update first so the UI never waits on the network.
    const optimistic = await this.cache.applySwipe(userId, recipeId, direction, deckId)

    const result = await this.callApplySwipe({ userId, recipeId, direction, deckId })
    if (!result) {
      const pending = readPending().filter(
        (s) => !(s.userId === userId && s.recipeId === recipeId),
      )
      writePending([...pending, { userId, recipeId, direction, deckId }])
      return optimistic
    }
    await this.cache.setPriority(result)
    return result
  }

  async unfavorite(userId: string, recipeId: string): Promise<RecipePriority> {
    const optimistic = await this.cache.unfavorite(userId, recipeId)

    const ok = await this.callUnfavorite(userId, recipeId)
    if (!ok) {
      const pending = readPendingUnfavorites().filter(
        (u) => !(u.userId === userId && u.recipeId === recipeId),
      )
      writePendingUnfavorites([...pending, { userId, recipeId }])
    }
    return optimistic
  }
}

export const store: SyncStore = new SupabaseStore()
