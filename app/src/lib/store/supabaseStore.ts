import { supabase } from '../supabaseClient'
import { LocalStore } from './localStore'
import type { SyncStore } from './types'
import type { Swipe, SwipeDirection } from '../../types/recipe'

const PENDING_KEY = 'recipe-app:pendingSwipes'

interface SwipeRow {
  user_id: string
  recipe_id: string
  direction: SwipeDirection
  swiped_at: string
}

function rowToSwipe(row: SwipeRow): Swipe {
  return {
    userId: row.user_id,
    recipeId: row.recipe_id,
    direction: row.direction,
    swipedAt: row.swiped_at,
  }
}

function readPending(): Swipe[] {
  const raw = localStorage.getItem(PENDING_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as Swipe[]
  } catch {
    return []
  }
}

function writePending(swipes: Swipe[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(swipes))
}

/**
 * Supabase-backed sync. The local store underneath serves two purposes:
 * an offline read cache (so the deck still loads with no network), and a
 * durable queue for swipes recorded while offline, retried on the next call
 * that touches the network — a swipe is never lost to a dropped connection,
 * just delayed in reaching the other phone.
 */
export class SupabaseStore implements SyncStore {
  private cache = new LocalStore()

  private async pushToSupabase(swipe: Swipe): Promise<boolean> {
    const { error } = await supabase.from('swipes').upsert(
      {
        user_id: swipe.userId,
        recipe_id: swipe.recipeId,
        direction: swipe.direction,
        swiped_at: swipe.swipedAt,
      },
      { onConflict: 'user_id,recipe_id' },
    )
    if (error) console.warn('Supabase upsert failed', error)
    return !error
  }

  private async flushPending() {
    const pending = readPending()
    if (!pending.length) return
    const stillPending: Swipe[] = []
    for (const swipe of pending) {
      const ok = await this.pushToSupabase(swipe)
      if (!ok) stillPending.push(swipe)
    }
    writePending(stillPending)
  }

  async getSwipesForUser(userId: string): Promise<Swipe[]> {
    await this.flushPending()
    try {
      const { data, error } = await supabase.from('swipes').select('*').eq('user_id', userId)
      if (error) throw error
      const swipes = (data as SwipeRow[]).map(rowToSwipe)
      for (const swipe of swipes) {
        await this.cache.recordSwipe(swipe.userId, swipe.recipeId, swipe.direction)
      }
      return swipes
    } catch (err) {
      console.warn('Supabase fetch failed, falling back to local cache', err)
      return this.cache.getSwipesForUser(userId)
    }
  }

  async getAllSwipes(): Promise<Swipe[]> {
    await this.flushPending()
    try {
      const { data, error } = await supabase.from('swipes').select('*')
      if (error) throw error
      const swipes = (data as SwipeRow[]).map(rowToSwipe)
      for (const swipe of swipes) {
        await this.cache.recordSwipe(swipe.userId, swipe.recipeId, swipe.direction)
      }
      return swipes
    } catch (err) {
      console.warn('Supabase fetch failed, falling back to local cache', err)
      return this.cache.getAllSwipes()
    }
  }

  async recordSwipe(userId: string, recipeId: string, direction: SwipeDirection): Promise<Swipe> {
    const swipe = await this.cache.recordSwipe(userId, recipeId, direction)
    const ok = await this.pushToSupabase(swipe)
    if (!ok) {
      const pending = readPending().filter(
        (s) => !(s.userId === userId && s.recipeId === recipeId),
      )
      writePending([...pending, swipe])
    }
    return swipe
  }
}

export const store: SyncStore = new SupabaseStore()
