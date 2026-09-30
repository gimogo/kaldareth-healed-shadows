/**
 * React binding for the typewriter engine.
 *
 * The engine (typewriter.ts) owns everything testable; this hook owns only the
 * clock: a requestAnimationFrame loop that re-slices the text as time passes.
 * `enabled: false` — or a reduced-motion preference, which counts the same —
 * renders the full text immediately: the animation is a flourish, never a gate
 * between the player and the numbers.
 */

import { useEffect, useState } from 'react'

import { typedCount, typedDuration } from './typewriter.ts'

/** The visible prefix of `text` after `elapsedMs`, animated unless disabled. */
export function useTypewriter(text: string, enabled: boolean): { shown: string; done: boolean } {
  // Read once at mount, in an initializer: the same pattern the playtest entry
  // uses for Date.now(), and the only render-safe way to touch the media query.
  const [prefersReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const animate = enabled && !prefersReduced

  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    // When not animating, subscribe to nothing: the render below returns the
    // full text and never reads `elapsed`, so there is nothing to reset here.
    if (!animate) return
    let raf = 0
    const start = performance.now()
    const total = typedDuration(text)
    const tick = (now: number) => {
      const t = now - start
      setElapsed(t)
      if (t < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animate, text])

  const count = animate ? typedCount(text, elapsed) : text.length
  return { shown: text.slice(0, count), done: count >= text.length }
}
