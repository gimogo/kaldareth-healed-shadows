/**
 * The typewriter engine, pinned by arithmetic.
 *
 * The board animation is pure time math, so the tests are exact: at 320 cps a
 * glyph costs 3.125ms, a newline a quarter of that. These pin the contract the
 * boards rely on — nothing visible before time zero, everything visible at the
 * duration, newlines cheaper than glyphs.
 */

import { describe, expect, it } from 'vitest'

import { CHARS_PER_SECOND, isTypedDone, typedCount, typedDuration } from '../../src/ui/typewriter.ts'

describe('the typewriter engine', () => {
  it('types at 320 glyphs per second by default', () => {
    expect(CHARS_PER_SECOND).toBe(320)
    // 2 glyphs = 6.25ms; the third is not yet paid for.
    expect(typedCount('abcd', 7)).toBe(2)
    expect(typedCount('abcd', 6.25)).toBe(2)
    expect(typedCount('abcd', 3.125)).toBe(1)
  })

  it('shows nothing before the first glyph is paid for', () => {
    expect(typedCount('abc', 0)).toBe(0)
    expect(typedCount('abc', -5)).toBe(0)
  })

  it('clamps to the full text no matter how long it runs', () => {
    expect(typedCount('abc', 10_000)).toBe(3)
    expect(typedCount('', 10_000)).toBe(0)
  })

  it('feeds newlines faster than glyphs, like an old terminal', () => {
    // 'ab' at 4ms: the second glyph (6.25ms) is not paid for yet.
    expect(typedCount('ab', 4)).toBe(1)
    // 'a\nb' at 4ms: a(3.125) + newline(0.78) are both paid, 'b' is not.
    expect(typedCount('a\nb', 4)).toBe(2)
  })

  it('knows when it is done, and how long it takes', () => {
    const text = 'row one\nrow two\n'
    const duration = typedDuration(text)
    expect(duration).toBeGreaterThan(0)
    expect(isTypedDone(text, duration)).toBe(true)
    expect(isTypedDone(text, duration - 0.01)).toBe(false)
  })

  it('respects an explicit speed', () => {
    // At 1000 cps each glyph costs 1ms.
    expect(typedCount('abcd', 2.5, 1000)).toBe(2)
    expect(typedDuration('ab', 1000)).toBe(2)
  })
})
