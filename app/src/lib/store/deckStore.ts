import { supabase } from '../supabaseClient'
import { generateId } from '../generateId'
import type { HouseholdMember } from '../profile'
import type { SwipeDeckShare, SwipeDeckSummary, TagCategory } from '../../types/recipe'

const MAX_DECK_SIZE = 40

interface SwipeDeckRow {
  id: string
  label: string
  source: 'auto' | 'manual'
  category: TagCategory | null
  tag_slug: string | null
  created_by: HouseholdMember | 'system'
  created_at: string
}

interface SwipeDeckShareRow {
  deck_id: string
  shared_with: HouseholdMember
  shared_by: HouseholdMember
  shared_at: string
  seen_at: string | null
}

function rowToDeck(row: SwipeDeckRow): SwipeDeckSummary {
  return {
    id: row.id,
    label: row.label,
    source: row.source,
    category: row.category,
    tagSlug: row.tag_slug,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function rowToShare(row: SwipeDeckShareRow): SwipeDeckShare {
  return {
    deckId: row.deck_id,
    sharedWith: row.shared_with,
    sharedBy: row.shared_by,
    sharedAt: row.shared_at,
    seenAt: row.seen_at,
  }
}

/** The standing, tag-derived decks — one category section each on DecksHomeScreen. */
async function listCategoryDecks(): Promise<SwipeDeckSummary[]> {
  const { data, error } = await supabase.from('swipe_decks').select('*').eq('source', 'auto')
  if (error) throw error
  return (data as SwipeDeckRow[]).map(rowToDeck)
}

export interface MyDeck {
  deck: SwipeDeckSummary
  /** Present when this deck reached the current user via an explicit share, not by owning it. */
  share: SwipeDeckShare | null
}

/** Decks a household member created, plus decks explicitly shared with them. */
async function listMyDecks(currentUser: HouseholdMember): Promise<MyDeck[]> {
  const [{ data: ownedRows, error: ownedError }, { data: shareRows, error: shareError }] = await Promise.all([
    supabase.from('swipe_decks').select('*').eq('source', 'manual').eq('created_by', currentUser),
    supabase.from('swipe_deck_shares').select('*').eq('shared_with', currentUser),
  ])
  if (ownedError) throw ownedError
  if (shareError) throw shareError

  const shares = (shareRows as SwipeDeckShareRow[]).map(rowToShare)
  const sharedDeckIds = shares.map((s) => s.deckId)
  const { data: sharedDeckRows, error: sharedDeckError } =
    sharedDeckIds.length > 0
      ? await supabase.from('swipe_decks').select('*').in('id', sharedDeckIds)
      : { data: [] as SwipeDeckRow[], error: null }
  if (sharedDeckError) throw sharedDeckError

  const shareByDeckId = new Map(shares.map((s) => [s.deckId, s]))
  const owned: MyDeck[] = (ownedRows as SwipeDeckRow[]).map((row) => ({ deck: rowToDeck(row), share: null }))
  const shared: MyDeck[] = (sharedDeckRows as SwipeDeckRow[]).map((row) => ({
    deck: rowToDeck(row),
    share: shareByDeckId.get(row.id) ?? null,
  }))
  return [...owned, ...shared]
}

export interface HomeDecks {
  myDecks: MyDeck[]
  categoryDecks: SwipeDeckSummary[]
  /** Full membership per deck, ordered by position — capped at 40 already by createDeck/build-swipe-decks.mjs. */
  recipeIdsByDeck: Map<string, string[]>
}

/**
 * Everything DecksHomeScreen needs in one shot: every deck plus its full
 * recipe-id membership, so the screen can derive both an accurate count and
 * a 3-photo preview. Every deck here is capped at 40 recipes already, so
 * loading full membership for every deck on the home screen (a few dozen
 * decks at most) is still comfortably within this codebase's existing
 * "small enough, just load wholesale" pattern (recipe_tags, imported_recipes).
 */
async function listHomeDecks(currentUser: HouseholdMember): Promise<HomeDecks> {
  const [myDecks, categoryDecks] = await Promise.all([listMyDecks(currentUser), listCategoryDecks()])

  const deckIds = [...myDecks.map((d) => d.deck.id), ...categoryDecks.map((d) => d.id)]
  const recipeIdsByDeck = new Map<string, string[]>()
  if (deckIds.length > 0) {
    const { data, error } = await supabase
      .from('swipe_deck_recipes')
      .select('deck_id, recipe_id')
      .in('deck_id', deckIds)
      .order('position', { ascending: true })
    if (error) throw error
    for (const row of data ?? []) {
      const ids = recipeIdsByDeck.get(row.deck_id) ?? []
      ids.push(row.recipe_id)
      recipeIdsByDeck.set(row.deck_id, ids)
    }
  }

  return { myDecks, categoryDecks, recipeIdsByDeck }
}

/** Lightweight count for the NavDrawer "Decks" link's badge — avoids loading full deck rows. */
async function getUnseenShareCount(currentUser: HouseholdMember): Promise<number> {
  const { count, error } = await supabase
    .from('swipe_deck_shares')
    .select('*', { count: 'exact', head: true })
    .eq('shared_with', currentUser)
    .is('seen_at', null)
  if (error) throw error
  return count ?? 0
}

async function getDeck(deckId: string): Promise<{ deck: SwipeDeckSummary; recipeIds: string[] } | null> {
  const { data: deckRow, error: deckError } = await supabase
    .from('swipe_decks')
    .select('*')
    .eq('id', deckId)
    .maybeSingle()
  if (deckError) throw deckError
  if (!deckRow) return null

  const { data: recipeRows, error: recipeError } = await supabase
    .from('swipe_deck_recipes')
    .select('recipe_id')
    .eq('deck_id', deckId)
    .order('position', { ascending: true })
  if (recipeError) throw recipeError

  return {
    deck: rowToDeck(deckRow as SwipeDeckRow),
    recipeIds: (recipeRows ?? []).map((row) => row.recipe_id as string),
  }
}

async function createDeck(
  label: string,
  recipeIds: string[],
  createdBy: HouseholdMember,
): Promise<SwipeDeckSummary> {
  const id = generateId()
  const cappedIds = recipeIds.slice(0, MAX_DECK_SIZE)

  const { error: deckError } = await supabase
    .from('swipe_decks')
    .insert({ id, label, source: 'manual', category: null, tag_slug: null, created_by: createdBy })
  if (deckError) throw deckError

  const { error: recipesError } = await supabase
    .from('swipe_deck_recipes')
    .insert(cappedIds.map((recipeId, position) => ({ deck_id: id, recipe_id: recipeId, position })))
  if (recipesError) throw recipesError

  return {
    id,
    label,
    source: 'manual',
    category: null,
    tagSlug: null,
    createdBy,
    createdAt: new Date().toISOString(),
  }
}

async function shareDeck(deckId: string, sharedBy: HouseholdMember, sharedWith: HouseholdMember): Promise<void> {
  const { error } = await supabase
    .from('swipe_deck_shares')
    .upsert(
      { deck_id: deckId, shared_with: sharedWith, shared_by: sharedBy, seen_at: null },
      { onConflict: 'deck_id,shared_with' },
    )
  if (error) throw error
}

async function markSeen(deckId: string, userId: HouseholdMember): Promise<void> {
  const { error } = await supabase
    .from('swipe_deck_shares')
    .update({ seen_at: new Date().toISOString() })
    .eq('deck_id', deckId)
    .eq('shared_with', userId)
  if (error) throw error
}

export const deckStore = {
  listCategoryDecks,
  listMyDecks,
  listHomeDecks,
  getUnseenShareCount,
  getDeck,
  createDeck,
  shareDeck,
  markSeen,
}
