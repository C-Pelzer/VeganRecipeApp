import { AnimatePresence, motion } from 'framer-motion'
import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../lib/profile'

interface NavDrawerProps {
  isOpen: boolean
  onClose: () => void
  currentUser: HouseholdMember
  onSwitchUser: () => void
  onSwitchTo: (member: HouseholdMember) => void
}

export function NavDrawer({ isOpen, onClose, currentUser, onSwitchUser, onSwitchTo }: NavDrawerProps) {
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

            {/* The destination list moved to the bottom tab bar. What's left is
                the one thing the tabs can't express: which of the two of us is
                using this device. */}
            <div className="flex flex-1 flex-col gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <p className="text-xs uppercase tracking-wide text-white/40">Signed in on this device</p>
              {HOUSEHOLD_MEMBERS.map((member) => (
                <button
                  key={member}
                  type="button"
                  onClick={() => {
                    if (member !== currentUser) onSwitchTo(member)
                    onClose()
                  }}
                  className={`flex min-h-11 items-center justify-between rounded-xl px-3 text-sm font-medium transition-colors ${
                    member === currentUser ? 'bg-neutral-800 text-white' : 'text-white/70'
                  }`}
                >
                  {member}
                  {member === currentUser && <span className="text-emerald-400">✓</span>}
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
