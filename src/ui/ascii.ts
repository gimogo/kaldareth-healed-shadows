/**
 * Tiny ASCII-art helpers for the home screen.
 *
 * The home screen is a `<pre>`, so these build plain text lines: a box title,
 * dotted label/value rows, fixed-width table rows, and centered captions.
 * Everything is width-driven so the caller owns the column count and nothing
 * overflows a 358px phone frame.
 */

/** Center `text` in `width` columns. */
export function asciiCenter(text: string, width: number): string {
  const pad = Math.max(0, width - text.length)
  const left = Math.floor(pad / 2)
  return ' '.repeat(left) + text + ' '.repeat(pad - left)
}

/** One `label ..... value` row, padded to `width`. */
export function asciiDotted(label: string, value: string, width: number): string {
  const gap = Math.max(1, width - label.length - value.length - 2)
  return `${label} ${'.'.repeat(gap)} ${value}`
}

/** Fixed-width table row: each cell padded to its column, single-space joined. */
export function asciiRow(cells: readonly string[], widths: readonly number[]): string {
  return cells
    .map((cell, index) => cell.padEnd(widths[index] ?? 0, ' '))
    .join(' ')
    .trimEnd()
}

/** `1`, `2`, `3` → `1st`, `2nd`, `3rd` — same rule as the leaderboard's. */
export function asciiOrdinal(n: number): string {
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? 'st'
      : n % 10 === 2 && n % 100 !== 12
        ? 'nd'
        : n % 10 === 3 && n % 100 !== 13
          ? 'rd'
          : 'th'
  return `${n}${suffix}`
}
