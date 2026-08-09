import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { deckStore } from '../lib/store/deckStore'
import type { HouseholdMember } from '../lib/profile'

interface NavDrawerProps {
  isOpen: boolean
  onClose: () => void
  currentUser: HouseholdMember
  onSwitchUser: () => void
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-neutral-800 text-white' : 'text-white/70'
  }`

export function NavDrawer({ isOpen, onClose, currentUser, onSwitchUser }: NavDrawerProps) {
  const [unseenCount, setUnseenCount] = useState(0)

  useEffect(() => {
    // Re-checked each time the drawer opens, so the badge clears once the
    // deck it flags has actually been opened, without needing a live subscription.
    if (isOpen) deckStore.getUnseenShareCount(currentUser).then(setUnseenCount)
  }, [isOpen, currentUser])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/60"
          />
          <motion.div
            key="panel"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.2 }}
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-neutral-950 text-white"
          >
            <div className="flex items-center justify-between p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-sm">
              <span className="font-medium">{currentUser}</span>
              <button
                type="button"
                aria-label="Switch user"
                onClick={() => {
                  onSwitchUser()
                  onClose()
                }}
                className="text-base leading-none text-white/50"
              >
                ⇄
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <nav className="flex flex-col gap-1">
                <NavLink to="/" onClick={onClose} className={navLinkClass}>
                  <span className="inline-flex items-center gap-2">
                    🏠 Decks
                    {unseenCount > 0 && (
                      <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-950">
                        {unseenCount}
                      </span>
                    )}
                  </span>
                </NavLink>
                <NavLink to="/favorites" onClick={onClose} className={navLinkClass}>
                  ★ Favorites
                </NavLink>
                <NavLink to="/shopping-list" onClick={onClose} className={navLinkClass}>
                  🛒 Shopping List
                </NavLink>
                <NavLink to="/meal-plan" onClick={onClose} className={navLinkClass}>
                  📋 Meal Plan
                </NavLink>
                <NavLink to="/meal-calendar" onClick={onClose} className={navLinkClass}>
                  📅 Meal Calendar
                </NavLink>
                <NavLink to="/import" onClick={onClose} className={navLinkClass}>
                  🔗 Import Recipe
                </NavLink>
                <NavLink to="/add-recipe" onClick={onClose} className={navLinkClass}>
                  ✍️ Add Recipe
                </NavLink>
                <NavLink to="/catalog" onClick={onClose} className={navLinkClass}>
                  🔍 Catalog
                </NavLink>
              </nav>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
