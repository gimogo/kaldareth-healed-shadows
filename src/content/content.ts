/**
 * Browser-side content loading.
 *
 * The JSON is imported statically so the content ships inside the bundle. A run
 * that needed a network fetch to know what the world contains would fail at the
 * worst moment, and the whole point of a seeded, deterministic run is that it is
 * reproducible offline.
 *
 * Parsing is delegated to loader.ts, so the browser and the check scripts
 * validate with identical rules.
 */

import rawContent from '../../content/kaldareth.act1.json'
import rawData from '../../content/kaldareth.json'
import rawBalance from '../../content/balance.json'

import { parseBalance, parseGameData, parseStoryContent } from './loader.ts'
import { combatBalanceOf, itemCatalogOf, rarityGlyphsOf, traitLabelsOf } from './loader.ts'

export const STORY = parseStoryContent(rawContent, 'content/kaldareth.act1.json')
export const DATA = parseGameData(rawData, 'content/kaldareth.json')
export const BALANCE = parseBalance(rawBalance, 'content/balance.json')

export const ITEMS = itemCatalogOf(DATA)
export const STAT_LABELS = traitLabelsOf(DATA)
export const RARITY_GLYPHS = rarityGlyphsOf(DATA)
export const COMBAT_BALANCE = combatBalanceOf(BALANCE)
