import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRecipes } from '../../lib/data'
import { deckStore, type HomeDecks } from '../../lib/store/deckStore'
import { store } from '../../lib/store/supabaseStore'
import { DECKS } from '../deck/decks'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'
import type { Recipe, SwipeDeckSummary, TagCategory } from '../../types/recipe'

interface DecksHomeScreenProps {
  currentUser: HouseholdMember
  onOpenMenu: () => void
}

const CATEGORY_LABELS: Record<TagCategory, string> = {
  cuisine: 'Cuisine',
  course: 'Course',
  ingredient: 'Ingredient',
  time: 'Time',
  book: 'Book',
}
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as TagCategory[]

// Prefers recipes that actually have a photo, but falls back to however many
// do exist rather than leaving a card with fewer panes than it could have.
function pickPreviewImages(recipeIds: string[], recipesById: Map<string, Recipe>): string[] {
  const images: string[] = []
  for (const id of recipeIds) {
    const image = recipesById.get(id)?.image
    if (image) images.push(image)
    if (images.length >= 3) break
  }
  return images
}

function matchesQuery(label: string, query: string): boolean {
  return label.toLowerCase().includes(query.trim().toLowerCase())
}

interface DeckCardProps {
  label: string
  images: string[]
  subtitle?: string
  unseen?: boolean
  onTap: () => void
}

function DeckCard({ label, images, subtitle, unseen, onTap }: DeckCardProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-800 text-left"
    >
      {images.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-800 to-neutral-900 text-4xl">
          🌱
        </div>
      ) : images.length === 1 ? (
        <img src={images[0]} alt="" className="h-full w-full object-cover" />
      ) : images.length === 2 ? (
        <div className="grid h-full grid-cols-2 gap-0.5">
          {images.map((src, i) => (
            <img key={i} src={src} alt="" className="h-full w-full object-cover" />
          ))}
        </div>
      ) : (
        <div className="grid h-full grid-cols-2 grid-rows-2 gap-0.5">
          <img src={images[0]} alt="" className="row-span-2 h-full w-full object-cover" />
          <img src={images[1]} alt="" className="h-full w-full object-cover" />
          <img src={images[2]} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      {unseen && <span className="absolute right-2 top-2 h-3 w-3 rounded-full bg-emerald-500 shadow" />}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pt-8">
        <p className="truncate text-sm font-semibold text-white">{label}</p>
        {subtitle && <p className="truncate text-xs text-white/60">{subtitle}</p>}
      </div>
    </button>
  )
}

export function DecksHomeScreen({ currentUser, onOpenMenu }: DecksHomeScreenProps) {
  const navigate = useNavigate()
  const { recipes, error: recipesError } = useRecipes()
  const [homeDecks, setHomeDecks] = useState<HomeDecks | null>(null)
  const [swipedRecipeIds, setSwipedRecipeIds] = useState<Set<string> | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [query, setQuery] = useState('')
  const [actionSheetDeck, setActionSheetDeck] = useState<SwipeDeckSummary | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const otherMember = useMemo(
    () => HOUSEHOLD_MEMBERS.find((m) => m !== currentUser) as HouseholdMember,
    [currentUser],
  )

  useEffect(() => {
    deckStore
      .listHomeDecks(currentUser)
      .then(setHomeDecks)
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
    store.getPriorities(currentUser).then((priorities) => {
      setSwipedRecipeIds(new Set(priorities.map((p) => p.recipeId)))
    })
  }, [currentUser])

  // A deck counts as "swiped through" once every recipe in it has been
  // decided on at least once — not the same as favorited or removed, just
  // seen. Used to drop finished decks off this person's own My Decks list
  // (both the ones they sent and the ones sent to them), per-user.
  function isFullySwiped(recipeIds: string[]): boolean {
    return recipeIds.length > 0 && recipeIds.every((id) => swipedRecipeIds?.has(id))
  }

  const recipesById = useMemo(() => new Map((recipes ?? []).map((r) => [r.id, r])), [recipes])

  // Not literally "unswiped" or "every recipe" — just decorative previews for
  // these two utility decks, pulled from the general pool.
  const quickAccessImages = useMemo(() => {
    if (!recipes) return []
    return recipes
      .filter((r) => !r.isComponent && r.image)
      .slice(0, 3)
      .map((r) => r.image as string)
  }, [recipes])

  function goToDeck(deckId: string) {
    navigate(`/deck/${deckId}`)
  }

  // Any real deck (auto or manual) can be sent — opening its sheet is also
  // what counts as "seen" for a deck that was sent to you.
  function openActionSheet(deck: SwipeDeckSummary, share?: { seenAt: string | null } | null) {
    if (share && !share.seenAt) deckStore.markSeen(deck.id, currentUser).catch(() => {})
    setSendError(null)
    setActionSheetDeck(deck)
  }

  function closeActionSheet() {
    if (sending) return
    setActionSheetDeck(null)
    setSendError(null)
  }

  function handleSend() {
    if (!actionSheetDeck) return
    setSending(true)
    setSendError(null)
    deckStore
      .shareDeck(actionSheetDeck.id, currentUser, otherMember)
      .then(() => setActionSheetDeck(null))
      .catch((err) => setSendError(err instanceof Error ? err.message : 'Something went wrong.'))
      .finally(() => setSending(false))
  }

  if (error || recipesError) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-white/70">
        Couldn't load decks.
      </div>
    )
  }

  if (!recipes || !homeDecks || !swipedRecipeIds) {
    return <div className="flex h-full items-center justify-center text-white/50">Loading decks…</div>
  }

  const myDecksOrdered = [
    ...homeDecks.myDecks.filter((d) => d.share),
    ...homeDecks.myDecks.filter((d) => !d.share),
  ]
  const myDecksFiltered = myDecksOrdered
    .filter((d) => !isFullySwiped(homeDecks.recipeIdsByDeck.get(d.deck.id) ?? []))
    .filter((d) => matchesQuery(d.deck.label, query))

  const categoryDecksByCategory = new Map<TagCategory, SwipeDeckSummary[]>()
  for (const category of CATEGORY_ORDER) categoryDecksByCategory.set(category, [])
  for (const deck of homeDecks.categoryDecks) {
    if (deck.category) categoryDecksByCategory.get(deck.category)?.push(deck)
  }
  for (const category of CATEGORY_ORDER) {
    categoryDecksByCategory.get(category)?.sort((a, b) => a.label.localeCompare(b.label))
  }

  const noDecksYet = homeDecks.myDecks.length === 0 && homeDecks.categoryDecks.length === 0

  return (
    <div className="flex h-full flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-4 flex items-center justify-between text-sm">
        <button
          type="button"
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="text-base leading-none text-white/50"
        >
          ☰
        </button>
        <span className="font-medium text-white">Decks</span>
        <span className="w-4" />
      </div>

      <input
        type="text"
        placeholder="Search decks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 rounded-xl bg-neutral-900 px-3 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
      />

      <div className="flex-1 space-y-6 overflow-y-auto pb-4">
        <div>
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/40">Quick Access</p>
          <div className="grid grid-cols-2 gap-3">
            {DECKS.map((d) => (
              <DeckCard key={d.id} label={d.label} images={quickAccessImages} onTap={() => goToDeck(d.id)} />
            ))}
          </div>
        </div>

        {noDecksYet && (
          <p className="px-1 text-sm text-white/50">
            No decks yet — check back once the deck pipeline has run, or build one from the Catalog.
          </p>
        )}

        {myDecksFiltered.length > 0 && (
          <div>
            <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/40">My Decks</p>
            <div className="grid grid-cols-2 gap-3">
              {myDecksFiltered.map(({ deck, share }) => {
                const recipeIds = homeDecks.recipeIdsByDeck.get(deck.id) ?? []
                return (
                  <DeckCard
                    key={deck.id}
                    label={deck.label}
                    images={pickPreviewImages(recipeIds, recipesById)}
                    subtitle={share ? `from ${share.sharedBy}` : `${recipeIds.length} recipes`}
                    unseen={!!share && !share.seenAt}
                    onTap={() => openActionSheet(deck, share)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {CATEGORY_ORDER.map((category) => {
          const decks = (categoryDecksByCategory.get(category) ?? []).filter((d) => matchesQuery(d.label, query))
          if (decks.length === 0) return null
          return (
            <div key={category}>
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/40">
                {CATEGORY_LABELS[category]}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {decks.map((deck) => {
                  const recipeIds = homeDecks.recipeIdsByDeck.get(deck.id) ?? []
                  return (
                    <DeckCard
                      key={deck.id}
                      label={deck.label}
                      images={pickPreviewImages(recipeIds, recipesById)}
                      subtitle={`${recipeIds.length} recipes`}
                      onTap={() => openActionSheet(deck)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {actionSheetDeck && (
        <>
          <div onClick={closeActionSheet} className="fixed inset-0 z-40 bg-black/60" />
          <div className="fixed left-1/2 top-1/2 z-50 w-72 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-neutral-900 p-4 text-white">
            <h2 className="text-base font-semibold">{actionSheetDeck.label}</h2>
            {sendError && <p className="mt-2 text-xs text-rose-400">{sendError}</p>}
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const id = actionSheetDeck.id
                  setActionSheetDeck(null)
                  goToDeck(id)
                }}
                className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-neutral-950"
              >
                Swipe this deck
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={sending}
                className="rounded-full bg-neutral-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {sending ? 'Sending…' : `Send to ${otherMember}`}
              </button>
              <button
                type="button"
                onClick={closeActionSheet}
                disabled={sending}
                className="px-4 py-2 text-sm font-medium text-white/60 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
