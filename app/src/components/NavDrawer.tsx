import { AnimatePresence, motion } from 'framer-motion'
import { NavLink } from 'react-router-dom'
import { DECKS, DEFAULT_DECK } from '../features/deck/decks'
import { groupByCategory, useRecipeTags } from '../lib/tags'
import type { HouseholdMember } from '../lib/profile'
import type { TagCategory } from '../types/recipe'

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

const CATEGORY_LABELS: Record<TagCategory, string> = {
  time: 'Time',
  cuisine: 'Cuisine',
  ingredient: 'Ingredient',
}

export function NavDrawer({ isOpen, onClose, currentUser, onSwitchUser }: NavDrawerProps) {
  const { tags } = useRecipeTags()
  const tagsByCategory = groupByCategory(tags ?? [])

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
            <div className="flex items-center justify-between p-4 text-sm">
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

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
              <nav className="flex flex-col gap-1">
                <NavLink to={`/deck/${DEFAULT_DECK.id}`} onClick={onClose} className={navLinkClass}>
                  Deck
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
              </nav>

              <div className="flex flex-col gap-1">
                <p className="px-3 text-xs font-medium uppercase tracking-wide text-white/40">
                  Categories
                </p>
                {DECKS.map((d) => (
                  <NavLink key={d.id} to={`/deck/${d.id}`} onClick={onClose} className={navLinkClass}>
                    {d.label}
                  </NavLink>
                ))}
              </div>

              {(Object.keys(CATEGORY_LABELS) as TagCategory[]).map((category) => {
                const categoryTags = tagsByCategory[category]
                if (!categoryTags.length) return null
                return (
                  <div key={category} className="flex flex-col gap-1">
                    <p className="px-3 text-xs font-medium uppercase tracking-wide text-white/40">
                      {CATEGORY_LABELS[category]}
                    </p>
                    {categoryTags.map((tag) => (
                      <NavLink
                        key={tag.slug}
                        to={`/deck/${tag.slug}`}
                        onClick={onClose}
                        className={navLinkClass}
                      >
                        {tag.label}
                      </NavLink>
                    ))}
                  </div>
                )
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
