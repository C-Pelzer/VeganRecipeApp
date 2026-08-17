import type { Segment } from './SegmentedTabs'

// Two pairs of drawer destinations were really one job split by input method or
// by stage, so each pair now lives inside a single tab as segments.

// Browsing the library and putting something into it.
export const CATALOG_SEGMENTS: Segment[] = [
  { to: '/catalog', label: 'Browse' },
  { to: '/import', label: 'From a link' },
  { to: '/add-recipe', label: 'By hand' },
]

// The meal plan is the calendar's staging area — things chosen but not yet
// given a day — not a separate destination.
export const PLAN_SEGMENTS: Segment[] = [
  { to: '/meal-calendar', label: 'Calendar' },
  { to: '/meal-plan', label: 'Unscheduled' },
]
