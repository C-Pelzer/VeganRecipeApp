import { forwardRef, useImperativeHandle } from 'react'
import { motion, useAnimation, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import type { Recipe, SwipeDirection } from '../../types/recipe'

const SWIPE_THRESHOLD = 100
const VELOCITY_THRESHOLD = 500

interface SwipeCardProps {
  recipe: Recipe
  isTop: boolean
  stackDepth: number
  onSwipe: (direction: SwipeDirection) => void
}

export interface SwipeCardHandle {
  triggerSwipe: (direction: SwipeDirection) => void
}

export const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard(
  { recipe, isTop, stackDepth, onSwipe },
  ref,
) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-300, 300], [-12, 12])
  const likeOpacity = useTransform(x, [20, 120], [0, 1])
  const nopeOpacity = useTransform(x, [-120, -20], [1, 0])
  const controls = useAnimation()

  async function flyOffScreen(direction: SwipeDirection) {
    await controls.start({
      x: direction === 'right' ? 600 : -600,
      rotate: direction === 'right' ? 20 : -20,
      opacity: 0,
      transition: { duration: 0.2 },
    })
    onSwipe(direction)
  }

  useImperativeHandle(ref, () => ({ triggerSwipe: flyOffScreen }))

  async function handleDragEnd(_event: unknown, info: PanInfo) {
    const passedThreshold = Math.abs(info.offset.x) > SWIPE_THRESHOLD
    const passedVelocity = Math.abs(info.velocity.x) > VELOCITY_THRESHOLD
    if (passedThreshold || passedVelocity) {
      await flyOffScreen(info.offset.x > 0 ? 'right' : 'left')
      return
    }
    controls.start({ x: 0, rotate: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } })
  }

  return (
    <motion.div
      className="absolute inset-0 touch-none select-none"
      style={{ x, rotate, zIndex: 10 - stackDepth }}
      animate={isTop ? controls : { scale: 1 - stackDepth * 0.04, y: stackDepth * 10 }}
      initial={{ scale: 1 - stackDepth * 0.04, y: stackDepth * 10 }}
      drag={isTop ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={1}
      onDragEnd={isTop ? handleDragEnd : undefined}
    >
      <div className="relative h-full w-full overflow-hidden rounded-3xl bg-neutral-800 shadow-xl shadow-black/40">
        {recipe.image ? (
          <img
            src={`/${recipe.image}`}
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
          </>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-4 pt-16">
          <p className="text-xs font-medium uppercase tracking-wide text-white/60">
            {recipe.source_book}
          </p>
          <h2 className="mt-1 text-xl font-semibold leading-tight text-white">{recipe.title}</h2>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-white/70">
            <span>{recipe.ingredient_count} ingredients</span>
            {recipe.time_text && <span>{recipe.time_text}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  )
})
