/** Local-time date helpers for the meal calendar's week grid. Everything
 * stays in local time (never toISOString/UTC) so "today" and slot dates
 * match what the device's clock shows the person standing in the kitchen. */

export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function startOfWeek(date: Date): Date {
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return addDays(midnight, -midnight.getDay())
}

export function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b)
}

export function formatWeekRangeLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6)
  const startLabel = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endLabel =
    weekStart.getMonth() === weekEnd.getMonth()
      ? weekEnd.toLocaleDateString(undefined, { day: 'numeric' })
      : weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${startLabel} – ${endLabel}`
}
