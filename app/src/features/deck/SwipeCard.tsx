import { forwardRef, useImperativeHandle, useRef } from 'react'
import { motion, useAnimation, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import type { Recipe, SwipeDirection } from '../../types/recipe'

const SWIPE_THRESHOLD = 100
const VELOCITY_THRESHOLD = 500
// Framer Motion's onTap can still fire after a real drag that didn't cross
// the swipe threshold (it sprang back rather than flying off) — the release
// still counts as "on target" since the card moved with the finger. Gate it
// on actually-measured distance instead of trusting tap/drag disambiguation.
const TAP_MAX_DRAG_DISTANCE = 10

interface SwipeCardProps {
  recipe: Recipe
  isTop: boolean
  stackDepth: number
  onSwipe: (recipeId: string, direction: SwipeDirection) => void
  onViewDetails: (recipeId: string) => void
}

export interface SwipeCardHandle {
  triggerSwipe: (direction: SwipeDirection) => void
}

export const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard(
  { recipe, isTop, stackDepth, onSwipe, onViewDetails },
  ref,
) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useTransform(x, [-300, 300], [-12, 12])
  const likeOpacity = useTransform(x, [20, 120], [0, 1])
  const nopeOpacity = useTransform(x, [-120, -20], [1, 0])
  const removeOpacity = useTransform(y, [20, 120], [0, 1])
  const controls = useAnimation()
  // A rapid double-tap/drag can call this again before the card's own state
  // updates unmount it — without this guard, the fly-off animation restarts
  // and onSwipe fires a second time for the same card.
  const hasSwipedRef = useRef(false)
  const dragDistanceRef = useRef(0)

  async function flyOffScreen(direction: SwipeDirection) {
    if (hasSwipedRef.current) return
    hasSwipedRef.current = true
    const exit =
      direction === 'down'
        ? { y: 700, transition: { duration: 0.2 } }
        : { x: direction === 'right' ? 600 : -600, rotate: direction === 'right' ? 20 : -20, transition: { duration: 0.2 } }
    await controls.start({ ...exit, opacity: 0 })
    onSwipe(recipe.id, direction)
  }

  useImperativeHandle(ref, () => ({ triggerSwipe: flyOffScreen }))

  // onDragStart doesn't fire for a press that never turns into a drag (a true
  // stationary tap) — reset on every press start (onTapStart fires for both)
  // so a prior interaction's distance can't leak into the next one.
  function handlePressStart() {
    dragDistanceRef.current = 0
  }

  function handleDrag(_event: unknown, info: PanInfo) {
    dragDistanceRef.current = Math.max(
      dragDistanceRef.current,
      Math.hypot(info.offset.x, info.offset.y),
    )
  }

  function handleTap() {
    if (dragDistanceRef.current > TAP_MAX_DRAG_DISTANCE) return
    onViewDetails(recipe.id)
  }

  async function handleDragEnd(_event: unknown, info: PanInfo) {
    const horizontal = Math.abs(info.offset.x) > Math.abs(info.offset.y)

    if (horizontal) {
      const passedThreshold = Math.abs(info.offset.x) > SWIPE_THRESHOLD
      const passedVelocity = Math.abs(info.velocity.x) > VELOCITY_THRESHOLD
      if (passedThreshold || passedVelocity) {
        await flyOffScreen(info.offset.x > 0 ? 'right' : 'left')
        return
      }
    } else {
      const passedThreshold = info.offset.y > SWIPE_THRESHOLD
      const passedVelocity = info.velocity.y > VELOCITY_THRESHOLD
      if (passedThreshold || passedVelocity) {
        await flyOffScreen('down')
        return
      }
    }
    controls.start({
      x: 0,
      y: 0,
      rotate: 0,
      transition: { type: 'spring', stiffness: 400, damping: 30 },
    })
  }

  return (
    <motion.div
      className="absolute inset-0 touch-none select-none"
      style={{ x, y, rotate, zIndex: 10 - stackDepth }}
      animate={isTop ? controls : { scale: 1 - stackDepth * 0.04, y: stackDepth * 10 }}
      initial={{ scale: 1 - stackDepth * 0.04, y: stackDepth * 10 }}
      drag={isTop}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={1}
      onTapStart={isTop ? handlePressStart : undefined}
      onDrag={isTop ? handleDrag : undefined}
      onDragEnd={isTop ? handleDragEnd : undefined}
      onTap={isTop ? handleTap : undefined}
    >
      <div className="relative h-full w-full overflow-hidden rounded-3xl bg-neutral-800 shadow-xl shadow-black/40">
        {recipe.image ? (
          <img
            src={recipe.image}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-800 to-neutral-900">
            <span className="text-6xl" aria-hidden="true">
              🌱
            </span>
          </div>
        )}

        {isTop && (
          <>
            <motion.div
              style={{ opacity: likeOpacity }}
              className="absolute left-6 top-6 -rotate-12 rounded-lg border-4 border-emerald-400 px-4 py-1 text-2xl font-black tracking-wider text-emerald-400"
            >
              YUM
            </motion.div>
            <motion.div
              style={{ opacity: nopeOpacity }}
              className="absolute right-6 top-6 rotate-12 rounded-lg border-4 border-rose-500 px-4 py-1 text-2xl font-black tracking-wider text-rose-500"
            >
              PASS
            </motion.div>
            <motion.div
              style={{ opacity: removeOpacity }}
              className="absolute left-1/2 top-6 -translate-x-1/2 rounded-lg border-4 border-neutral-400 px-4 py-1 text-2xl font-black tracking-wider text-neutral-300"
            >
              REMOVE
            </motion.div>
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pt-16">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-white/60">
                {recipe.source_book}
              </p>
              <h2 className="mt-1 text-xl font-semibold leading-tight text-white">
                {recipe.title}
              </h2>
            </div>
            {isTop && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onViewDetails(recipe.id)
                }}
                aria-label="View recipe details"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-base text-white"
              >
                ⓘ
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/70">
            <span>{recipe.ingredient_count} ingredients</span>
            {recipe.time_text && <span>{recipe.time_text}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  )
})
