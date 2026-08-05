# Plan: Hamburger menu with a Categories section for decks

## Project context (for an agent with no prior history on this repo)

This is a private, two-person (Cameron + Mallorie) household vegan recipe app — a Tinder-style
swipe deck over recipes extracted from cookbook epubs. React PWA (Vite + TypeScript + Tailwind),
state synced through Supabase (two tables: `recipe_priority`, `swipe_events`, plus an
`apply_swipe` Postgres RPC — not relevant to this task, just context). No auth: a device just
remembers which household member is using it (`app/src/lib/profile.ts`).

Current screens, all under `app/src/features/`:
- `deck/DeckScreen.tsx` — the swipe deck. Has a deck-variety picker (New vs Everything, defined
  in `deck/decks.ts`) and small inline header buttons.
- `favorites/FavoritesScreen.tsx` — "Yours" / "Shared" (mutual) favorited recipes.
- `recipe/RecipeDetailScreen.tsx` — full recipe view, reached by tapping a card or a favorites
  row. Has its own dedicated back arrow. **Not in scope for this task.**

Routing lives in `app/src/App.tsx` via `react-router-dom` v7.

## The ask

Cameron wants the small header buttons currently scattered across `DeckScreen` and
`FavoritesScreen` (★ favorites link, ⇄ switch-user, and the New/Everything deck toggle)
consolidated into a single hamburger (☰) menu that slides in from the left. That menu should
also have a **Categories** section listing the available decks — today just New/Everything, but
this is deliberately the landing spot for future deck variety (NewIdeas.txt item 2: cook-time,
cuisine, ingredient-based decks) once that data/work exists. Don't build those other deck types
now — just make sure Categories is structured so adding a new entry to `DECKS` is all a future
pass needs to do.

## Current relevant code

`app/src/features/deck/decks.ts` (unchanged by this task, just context):
```ts
import type { Deck } from '../../types/recipe'

export const DECKS: Deck[] = [
  { id: 'new', label: 'New', isEligible: (_recipe, priority) => !priority },
  { id: 'everything', label: 'Everything', isEligible: () => true },
]

export const DEFAULT_DECK = DECKS[1]
```

`app/src/App.tsx` (current, before this task):
```tsx
import { useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { DeckScreen } from './features/deck/DeckScreen'
import { FavoritesScreen } from './features/favorites/FavoritesScreen'
import { RecipeDetailScreen } from './features/recipe/RecipeDetailScreen'
import { ProfilePicker } from './features/profile/ProfilePicker'
import { clearCurrentUser, getCurrentUser, setCurrentUser, type HouseholdMember } from './lib/profile'

function App() {
  const [currentUser, setCurrentUserState] = useState<HouseholdMember | null>(getCurrentUser)

  function handleSelect(user: HouseholdMember) {
    setCurrentUser(user)
    setCurrentUserState(user)
  }

  function handleSwitchUser() {
    clearCurrentUser()
    setCurrentUserState(null)
  }

  return (
    <div className="h-full min-h-screen bg-neutral-950">
      {currentUser ? (
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<DeckScreen currentUser={currentUser} onSwitchUser={handleSwitchUser} />} />
            <Route path="/favorites" element={<FavoritesScreen currentUser={currentUser} onSwitchUser={handleSwitchUser} />} />
            <Route path="/recipe/:id" element={<RecipeDetailScreen />} />
          </Routes>
        </BrowserRouter>
      ) : (
        <ProfilePicker onSelect={handleSelect} />
      )}
    </div>
  )
}

export default App
```

`app/src/features/deck/DeckScreen.tsx` — relevant parts (current, before this task):
```tsx
interface DeckScreenProps {
  currentUser: HouseholdMember
  onSwitchUser: () => void
}

export function DeckScreen({ currentUser, onSwitchUser }: DeckScreenProps) {
  // ...
  const [deck, setDeck] = useState<Deck>(DEFAULT_DECK)
  // ... deck is read in the effect that rebuilds `queue`, and used as deck.id when calling
  // store.applySwipe(currentUser, recipeId, direction, deck.id)

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between text-sm text-white/50">
        <div className="flex items-center gap-2">
          <span>{currentUser}</span>
          <Link to="/favorites" aria-label="Favorites" className="text-base leading-none">★</Link>
          <button type="button" aria-label="Switch user" onClick={onSwitchUser} className="text-base leading-none text-white/50">⇄</button>
        </div>
        <div className="flex gap-1 rounded-full bg-neutral-900 p-1">
          {DECKS.map((d) => (
            <button key={d.id} type="button" onClick={() => setDeck(d)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${d.id === deck.id ? 'bg-neutral-700 text-white' : 'text-white/50'}`}>
              {d.label}
            </button>
          ))}
        </div>
        <span>{reviewed} / {sessionTotal}</span>
      </div>
      {/* ...card stack + pass/remove/yum buttons unchanged... */}
    </div>
  )
}
```

`app/src/features/favorites/FavoritesScreen.tsx` — relevant header part (current, before this
task):
```tsx
interface FavoritesScreenProps {
  currentUser: HouseholdMember
  onSwitchUser: () => void
}

export function FavoritesScreen({ currentUser, onSwitchUser }: FavoritesScreenProps) {
  // ...
  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Link to="/" className="text-white/50">← Deck</Link>
          <button type="button" aria-label="Switch user" onClick={onSwitchUser} className="text-base leading-none text-white/50">⇄</button>
        </div>
        <div className="flex gap-1 rounded-full bg-neutral-900 p-1">{/* Yours/Shared tabs */}</div>
        <span className="text-white/50">{favoriteRecipes.length}</span>
      </div>
      {/* ...favorites list unchanged... */}
    </div>
  )
}
```

## Design

### 1. Deck selection moves from component state to the URL
For a single global menu (rendered once, not duplicated per-screen) to display and change the
active deck from anywhere, deck selection needs to be reachable independent of `DeckScreen`'s
own state. Use a route: **`/deck/:deckId`**, with `/` redirecting to `/deck/${DEFAULT_DECK.id}`
(react-router's `<Navigate replace>`). `DeckScreen` reads `deckId` via `useParams<{ deckId:
string }>()`, looks it up in `DECKS`, falls back to `DEFAULT_DECK` if unmatched:
```ts
const { deckId } = useParams<{ deckId: string }>()
const deck = DECKS.find((d) => d.id === deckId) ?? DEFAULT_DECK
```
Since `DECKS` entries are stable module-level object references, `.find()` returns the same
reference for the same id on every render — the existing `useEffect` dependency array that
rebuilds the swipe queue on `[recipes, priorities, deck]` still triggers correctly only when
the deck actually changes. Delete the local `useState<Deck>` — `deck` is now derived, not state.

Selecting a category in the menu becomes a plain `<Link to={`/deck/${d.id}`}>` — no prop drilling
needed.

### 2. New: `app/src/components/NavDrawer.tsx`
First shared/global component in the app (everything so far lives under `features/`) — this is
navigation chrome, not a feature. Props: `isOpen: boolean`, `onClose: () => void`, `currentUser:
HouseholdMember`, `onSwitchUser: () => void`. Content, top to bottom:
- Current user's name + the ⇄ switch-user control (moved here from both headers).
- Nav links: "Deck" (→ `/deck/${DEFAULT_DECK.id}`), "★ Favorites" (→ `/favorites`).
- **Categories** section: a small heading, then `DECKS.map(...)` rendered as `NavLink`s to
  `/deck/<id>`, with the currently-active one visually distinguished (`NavLink`'s `isActive`
  render-prop, or compare against `useParams().deckId` / `location.pathname`).

Slide in from the left with a click-outside-to-close overlay. Use `framer-motion` (already a
dependency, already this app's animation approach for the swipe cards) rather than introducing
something new — an `AnimatePresence` wrapping an overlay `motion.div` (fade) and a panel
`motion.div` (`x: '-100%'` → `x: 0`) is enough; no new dependency required.

Every link inside the drawer should call `onClose` on click (in addition to navigating) so it
doesn't stay open after the user picks something.

### 3. Rendered once, at the top level
`App.tsx` owns `menuOpen` state and renders `<NavDrawer>` as a sibling to `<Routes>` (inside the
`<BrowserRouter>`, not inside any one screen's route element), passing each screen an
`onOpenMenu={() => setMenuOpen(true)}` callback instead of the `onSwitchUser` prop they take
today — switching users only happens through the drawer now, so screens no longer need that
prop directly. `handleSwitchUser` (already exists in `App.tsx`) gets passed to `<NavDrawer>`
instead of to each screen, and should also close the drawer when called.

New route list:
```tsx
<Route path="/" element={<Navigate to={`/deck/${DEFAULT_DECK.id}`} replace />} />
<Route path="/deck/:deckId" element={<DeckScreen currentUser={currentUser} onOpenMenu={() => setMenuOpen(true)} />} />
<Route path="/favorites" element={<FavoritesScreen currentUser={currentUser} onOpenMenu={() => setMenuOpen(true)} />} />
<Route path="/recipe/:id" element={<RecipeDetailScreen />} />
```
(`Navigate` and `DEFAULT_DECK` need new imports in `App.tsx`.)

### 4. Header cleanup
- **`DeckScreen.tsx`**: header shrinks to a ☰ button (left, calls `onOpenMenu`) → `deck.label`
  (center, just text now — replaces the toggle buttons) → session counter (right, unchanged).
  Remove the inline deck-toggle buttons and the ★/⇄ controls (moved to the drawer). Current
  user's name is no longer shown inline in this header — one tap away in the drawer, and this
  is a single-device-per-person app so who's-logged-in is rarely in question mid-swipe. This is
  a deliberate UI change worth Cameron noticing, not a silent omission — easy to add back
  (e.g. next to the ☰) if it turns out to be missed in practice.
- **`FavoritesScreen.tsx`**: header becomes ☰ (left) → Yours/Shared tabs (center, unchanged) →
  count (right, unchanged). Remove the "← Deck" text link and ⇄ (Deck nav + switch-user both
  live in the drawer now).
- **`RecipeDetailScreen.tsx`**: **no changes.** Its own dedicated back arrow already serves its
  one navigation need; it has no small-button clutter to consolidate and wasn't part of the ask.

### Files touched
- New: `app/src/components/NavDrawer.tsx`
- Modified: `app/src/App.tsx`, `app/src/features/deck/DeckScreen.tsx`,
  `app/src/features/favorites/FavoritesScreen.tsx`
- Unchanged (read/reference only): `app/src/features/deck/decks.ts`, `app/src/lib/profile.ts`,
  `app/src/features/recipe/RecipeDetailScreen.tsx`

## Build order

1. `NavDrawer.tsx` component (can be built/styled in isolation before wiring).
2. `App.tsx`: routing change (`/deck/:deckId`, `Navigate` redirect), render `<NavDrawer>`,
   thread `onOpenMenu`/`onSwitchUser` correctly.
3. `DeckScreen.tsx`: switch `deck` from state to `useParams`-derived, strip the header down.
4. `FavoritesScreen.tsx`: strip the header down, add ☰.
5. Typecheck/build after each step rather than only at the end.

## Verification

- `npm run build` (tsc + vite) clean after each file, not just at the end.
- A Playwright pass against the dev/preview build (this project's established pattern —
  `npm run preview`, headless Chromium, screenshot key states):
  - Open the drawer from the deck screen; confirm current user's name + switch control appear.
  - Confirm Categories shows New and Everything, with the currently-active one visually
    distinguished.
  - Select a category from the drawer; confirm the deck actually changes — e.g. check the URL
    becomes `/deck/new` or `/deck/everything`, and that the recipe pool differs the same way the
    old inline toggle proved it did (picking "New" after favoriting one recipe should show one
    fewer than "Everything" — this exact check was already done for the old toggle and should
    still hold).
  - Navigate to `/favorites` via the drawer; confirm its ☰ opens the same drawer component.
  - Confirm switch-user still works from inside the drawer, from both screens.
  - Confirm clicking the overlay (outside the sliding panel) closes the drawer without
    navigating anywhere.
  - Confirm no console errors.
  - This app is synced through a live Supabase project — if the verification pass records any
    test swipes/priorities, delete them again afterward (`recipe_priority` /
    `swipe_events` tables, filtered by `user_id`) so no test data lingers in the real dataset.
