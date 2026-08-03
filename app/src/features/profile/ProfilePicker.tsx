import { HOUSEHOLD_MEMBERS, type HouseholdMember } from '../../lib/profile'

interface ProfilePickerProps {
  onSelect: (user: HouseholdMember) => void
}

export function ProfilePicker({ onSelect }: ProfilePickerProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-white">Who's swiping?</h1>
        <p className="mt-1 text-white/50">Just so we know whose picks are whose.</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-4">
        {HOUSEHOLD_MEMBERS.map((member) => (
          <button
            key={member}
            type="button"
            onClick={() => onSelect(member)}
            className="rounded-2xl bg-neutral-800 py-4 text-lg font-medium text-white shadow-lg active:scale-95"
          >
            {member}
          </button>
        ))}
      </div>
    </div>
  )
}
