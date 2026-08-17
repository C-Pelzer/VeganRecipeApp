import { useNavigate } from 'react-router-dom'

// The two combined tabs (Catalog, Calendar) each hold screens that used to be
// separate drawer destinations. Segments keep them one tap apart inside their
// tab instead of burying one behind the other.

export interface Segment {
  to: string
  label: string
}

interface SegmentedTabsProps {
  segments: Segment[]
  activeTo: string
}

export function SegmentedTabs({ segments, activeTo }: SegmentedTabsProps) {
  const navigate = useNavigate()

  return (
    <div className="mb-3 flex gap-1 rounded-xl bg-neutral-900 p-1" role="tablist">
      {segments.map((segment) => {
        const active = segment.to === activeTo
        return (
          <button
            key={segment.to}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => navigate(segment.to)}
            className={`min-h-11 flex-1 rounded-lg px-3 text-sm transition-colors ${
              active ? 'bg-neutral-800 font-semibold text-neutral-100' : 'text-neutral-400'
            }`}
          >
            {segment.label}
          </button>
        )
      })}
    </div>
  )
}
