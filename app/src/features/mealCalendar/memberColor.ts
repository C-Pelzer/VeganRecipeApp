// A household can now have any number of members, so colors are assigned by
// a deterministic hash over their profile id rather than a fixed 2-entry
// lookup — the same person always lands on the same color on every device,
// without needing a table or any coordination.
const PALETTE = [
  'bg-purple-500',
  'bg-pink-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-teal-500',
]

export const UNASSIGNED_COLOR = 'bg-neutral-700'

export function memberColor(profileId: string): string {
  let hash = 0
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash * 31 + profileId.charCodeAt(i)) | 0
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]
}
