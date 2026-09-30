/**
 * The typewriter engine behind the ASCII boards.
 *
 * Pure and time-based, not tick-based: given the full text and how many
 * milliseconds have elapsed, it answers how many characters are visible. The
 * component owns only the clock; everything testable lives here, so the
 * animation is pinned by unit tests without a DOM.
 *
 * Newlines type faster than glyphs (OLD TERMINALS fed them in one bite), so a
 * 44-column board reveals line by line rather than crawling across every row.
 */

/** Glyphs per second. ~320 feels like a fast terminal, not a crawl. */
export const CHARS_PER_SECOND = 320

/** A newline costs a fraction of a glyph's time — this many times faster. */
export const LINE_SPEEDUP = 4

/**
 * How many characters of `text` are visible after `elapsedMs`.
 *
 * Walks the text charging each glyph `1000 / cps` ms and each newline a
 * quarter of that, so the answer is exact for any elapsed time and any text.
 * Clamped to `[0, text.length]`.
 */
export function typedCount(text: string, elapsedMs: number, cps = CHARS_PER_SECOND): number {
  if (elapsedMs <= 0) return 0
  const perChar = 1000 / Math.max(1, cps)
  const perLine = perChar / LINE_SPEEDUP
  let t = 0
  for (let i = 0; i < text.length; i += 1) {
    t += text[i] === '\n' ? perLine : perChar
    if (t > elapsedMs) return i
  }
  return text.length
}

/** True once the whole text would be visible. */
export function isTypedDone(text: string, elapsedMs: number, cps = CHARS_PER_SECOND): boolean {
  return typedCount(text, elapsedMs, cps) >= text.length
}

/** Total time the animation takes, in milliseconds. */
export function typedDuration(text: string, cps = CHARS_PER_SECOND): number {
  const perChar = 1000 / Math.max(1, cps)
  const perLine = perChar / LINE_SPEEDUP
  let t = 0
  for (const ch of text) t += ch === '\n' ? perLine : perChar
  return t
}
