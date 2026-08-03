import type { Swipe, SwipeDirection } from '../../types/recipe'
import type { SyncStore } from './types'

const STORAGE_KEY = 'recipe-app:swipes'

function readAll(): Swipe[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as Swipe[]
  } catch {
    return []
  }
}

function writeAll(swipes: Swipe[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(swipes))
}

export class LocalStore implements SyncStore {
  async getSwipesForUser(userId: string): Promise<Swipe[]> {
    return readAll().filter((swipe) => swipe.userId === userId)
  }

  async getAllSwipes(): Promise<Swipe[]> {
    return readAll()
  }

  async recordSwipe(userId: string, recipeId: string, direction: SwipeDirection): Promise<Swipe> {
    const swipe: Swipe = { userId, recipeId, direction, swipedAt: new Date().toISOString() }
    const all = readAll()
    const withoutPrevious = all.filter(
      (existing) => !(existing.userId === userId && existing.recipeId === recipeId),
    )
    writeAll([...withoutPrevious, swipe])
    return swipe
  }
}
