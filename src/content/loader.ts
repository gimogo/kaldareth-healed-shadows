/**
 * Content loading and parsing.
 *
 * Parsing is separated from loading on purpose. `src/content/content.ts` does
 * the Vite static imports for the browser bundle; the check scripts do their own
 * `readFileSync`. Both then hand the parsed JSON to the functions here, so the
 * browser and CI validate content with byte-identical rules.
 *
 * Failures are formatted for a human editing JSON, with a JSON-pointer path per
 * issue, because the alternative is a wall of raw zod output.
 */

import { balanceSchema, gameDataSchema, storyContentSchema } from './schema.ts'
import type { Balance, GameData } from './schema.ts'
import type { StoryContent } from '../engine/types.ts'
import type { ItemCatalog } from '../engine/items.ts'
import type { TraitLabels } from '../engine/stats.ts'
import type { CombatBalance } from '../engine/combat.ts'
import type { Rarity, TraitId } from '../engine/types.ts'

export class ContentError extends Error {
  readonly issues: string[]
  constructor(source: string, issues: string[]) {
    super(`${source} failed validation:\n  - ${issues.join('\n  - ')}`)
    this.name = 'ContentError'
    this.issues = issues
  }
}

function formatIssues(error: unknown): string[] {
  const issues = (error as { issues?: unknown }).issues
  if (!Array.isArray(issues)) return [String(error)]
  return issues.map((issue) => {
    const path = (issue as { path?: unknown[] }).path
    const where = Array.isArray(path) && path.length > 0 ? path.join('.') : '(root)'
    return `${where}: ${(issue as { message?: string }).message ?? 'invalid'}`
  })
}

function parseWith<T>(source: string, schema: { safeParse: (u: unknown) => { success: true; data: T } | { success: false; error: unknown } }, raw: unknown): T {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  throw new ContentError(source, formatIssues(result.error))
}

/* ── Parsers ──────────────────────────────────────────────────────────── */

export function parseStoryContent(raw: unknown, source = 'story content'): StoryContent {
  return parseWith(source, storyContentSchema, raw) as StoryContent
}

export function parseGameData(raw: unknown, source = 'game data'): GameData {
  return parseWith(source, gameDataSchema, raw) as GameData
}

export function parseBalance(raw: unknown, source = 'balance'): Balance {
  return parseWith(source, balanceSchema, raw) as Balance
}

/* ── Derived views ────────────────────────────────────────────────────── */

export function itemCatalogOf(data: GameData): ItemCatalog {
  return data.items
}

export function traitLabelsOf(data: GameData): TraitLabels {
  return data.statLabels as unknown as TraitLabels
}

export function combatBalanceOf(balance: Balance): CombatBalance {
  return balance.combat
}

export function rarityGlyphsOf(data: GameData): Record<Rarity, string> {
  const out = {} as Record<Rarity, string>
  for (const [key, value] of Object.entries(data.rarityLabels)) {
    out[key as Rarity] = value.glyph
  }
  return out
}

export const TRAIT_ORDER: readonly TraitId[] = ['courage', 'reputation', 'royal_loyalty']

/* ── Prose placeholders ───────────────────────────────────────────────── */

/**
 * Marker used for unwritten prose. The content validator fails on any of these,
 * so a placeholder can never reach a submission by accident.
 */
export const PROSE_PLACEHOLDER = 'TODO'

export function containsPlaceholder(text: string): boolean {
  return text.includes(PROSE_PLACEHOLDER)
}
