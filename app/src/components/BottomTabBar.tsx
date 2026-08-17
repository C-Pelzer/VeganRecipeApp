// Plain Link, not NavLink: NavLink derives its own aria-current from exact
// route matching and overrides the prop, so a tab holding sub-routes (Catalog
// while you're on /import) announced itself as not-current.
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { deckStore } from '../lib/store/deckStore'
import type { HouseholdMember } from '../lib/profile'

// Replaces the drawer as the primary way through the app. The drawer put eight
// flat destinations behind a ~16px glyph in the top-left corner, so every
// navigation was two taps starting from a stretch target — awkward one-handed
// in a kitchen. These are the same destinations, minus the two pairs that were
// really one job split in two (Import + Add Recipe, Meal Plan + Calendar).

interface Tab {
  to: string
  label: string
  icon: string
  // Routes that belong to this tab but aren't its own path, so the tab still
  // reads as active while you're on them.
  alsoMatches?: string[]
}

const TABS: Tab[] = [
  { to: '/', label: 'Decks', icon: '🍽', alsoMatches: ['/deck/'] },
  { to: '/catalog', label: 'Catalog', icon: '🔍', alsoMatches: ['/import', '/add-recipe'] },
  { to: '/favorites', label: 'Favorites', icon: '★' },
  { to: '/shopping-list', label: 'Shopping', icon: '🛒' },
  { to: '/meal-calendar', label: 'Calendar', icon: '📅', alsoMatches: ['/meal-plan'] },
]

function isActive(tab: Tab, pathname: string): boolean {
  if (tab.to === '/') return pathname === '/' || pathname.startsWith('/deck/')
  if (pathname === tab.to) return true
  return (tab.alsoMatches ?? []).some((p) => pathname.startsWith(p))
}

interface BottomTabBarProps {
  currentUser: HouseholdMember
}

export function BottomTabBar({ currentUser }: BottomTabBarProps) {
  const { pathname } = useLocation()
  const [unseenCount, setUnseenCount] = useState(0)

  // Re-checked on every navigation rather than on a live subscription, so the
  // badge clears once the shared deck it flags has actually been opened. This
  // used to live on the drawer's Decks link, which only refreshed when the
  // drawer was opened — the badge is more useful somewhere always on screen.
  useEffect(() => {
    let cancelled = false
    deckStore
      .getUnseenShareCount(currentUser)
      .then((n) => {
        if (!cancelled) setUnseenCount(n)
      })
      .catch(() => {
        // A failed count shouldn't blank the nav; just leave the badge off.
      })
    return () => {
      cancelled = true
    }
  }, [currentUser, pathname])

  return (
    <nav
      // pb keeps the labels clear of the home indicator on a gesture-nav phone.
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-800 bg-neutral-900/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      aria-label="Main"
    >
      {TABS.map((tab) => {
        const active = isActive(tab, pathname)
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            // min-h-[3.25rem] keeps every target comfortably past the 44px
            // minimum, which the old 16px menu glyph was nowhere near.
            className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[0.6875rem] transition-colors ${
              active ? 'text-emerald-400' : 'text-neutral-500'
            }`}
          >
            <span className="relative">
              <span aria-hidden="true" className={`text-lg leading-none ${active ? '' : 'opacity-60 grayscale'}`}>
                {tab.icon}
              </span>
              {tab.to === '/' && unseenCount > 0 && (
                <span className="absolute -right-2 -top-1 rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold leading-4 text-neutral-950">
                  {unseenCount}
                </span>
              )}
            </span>
            <span className={active ? 'font-semibold' : ''}>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
