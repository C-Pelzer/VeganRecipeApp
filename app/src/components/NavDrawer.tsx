import { AnimatePresence, motion } from 'framer-motion'
import type { Household, Profile } from '../lib/auth'

interface NavDrawerProps {
  isOpen: boolean
  onClose: () => void
  profile: Profile
  household: Household
  onSignOut: () => void
}

export function NavDrawer({ isOpen, onClose, profile, household, onSignOut }: NavDrawerProps) {
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
            <div className="flex items-center gap-3 p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-sm">
              {profile.avatarUrl && (
                <img src={profile.avatarUrl} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium">{profile.displayName || profile.email}</p>
                <p className="truncate text-xs text-white/50">{household.name}</p>
              </div>
            </div>

            {/* The destination list moved to the bottom tab bar. What's left is
                account-level stuff the tabs can't express: this household's
                invite code, and signing out. */}
            <div className="flex flex-1 flex-col gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="rounded-xl bg-neutral-800 px-3 py-3">
                <p className="text-xs uppercase tracking-wide text-white/40">Invite code</p>
                <p className="mt-1 text-lg font-semibold tracking-widest">{household.inviteCode}</p>
                <p className="mt-1 text-xs text-white/50">Share this so someone else can join {household.name}.</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  onSignOut()
                  onClose()
                }}
                className="mt-auto flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-white/70"
              >
                Sign out
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
