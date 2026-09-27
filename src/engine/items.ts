/**
 * Item helpers.
 *
 * Act 1 has exactly one equip slot and no crafting bench, so equip rules stay
 * deliberately thin. The `craftedBy` and `materials` fields exist on the type
 * already so content written for later acts never needs a schema migration.
 *
 * The catalogue is passed in rather than imported: the engine stays free of
 * content loading, which is what keeps it testable and lets the validator and
 * the game share one source of truth.
 */

import type { Inventory, ItemDefinition, Rarity } from './types.ts'
import { RARITIES } from './types.ts'

export type ItemCatalog = Record<string, ItemDefinition>

/** Single-character glyph so rarity is legible without relying on colour. */
const RARITY_GLYPH: Record<Rarity, string> = {
  common: '·',
  uncommon: '+',
  rare: '◆',
  epic: '✦',
  legendary: '★',
}

const RARITY_WORD: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
}

export function rarityGlyph(rarity: Rarity): string {
  return RARITY_GLYPH[rarity]
}

export function rarityWord(rarity: Rarity): string {
  return RARITY_WORD[rarity]
}

/** Ascending index, used for sorting and for comparing two items. */
export function rarityRank(rarity: Rarity): number {
  return RARITIES.indexOf(rarity)
}

/** Full display line: glyph, name, rarity, and the bonus it grants. */
export function describeItem(item: ItemDefinition): string {
  const bonus =
    item.stat !== undefined && item.bonus !== undefined
      ? ` ${item.stat === 'critChance' ? `+${(item.bonus * 100).toFixed(1)}% crit` : `+${item.bonus} ${item.stat}`}`
      : ''
  return `${rarityGlyph(item.rarity)} ${item.name} [${rarityWord(item.rarity)}]${bonus}`
}

export function findItem(catalog: ItemCatalog, id: string): ItemDefinition | undefined {
  return catalog[id]
}

export function addItem(inventory: Inventory, item: ItemDefinition): Inventory {
  // Ids are unique per drop, so a second copy is a distinct entry. Re-adding the
  // same id would double-stat, so it is treated as a no-op instead.
  if (inventory.items.some((i) => i.id === item.id)) return inventory
  return { ...inventory, items: [...inventory.items, item] }
}

/** The empty slot is worth less than a flat boost, so any item beats nothing. */
export function equipItem(inventory: Inventory, itemId: string): Inventory {
  if (!inventory.items.some((i) => i.id === itemId)) return inventory
  return { ...inventory, equippedId: itemId }
}

export function unequipItem(inventory: Inventory): Inventory {
  return inventory.equippedId === null ? inventory : { ...inventory, equippedId: null }
}

export function equippedItem(inventory: Inventory): ItemDefinition | undefined {
  return inventory.equippedId ? inventory.items.find((i) => i.id === inventory.equippedId) : undefined
}

/** Inventory in descending rarity, so the strongest gear reads first. */
export function sortInventory(items: readonly ItemDefinition[]): ItemDefinition[] {
  return [...items].sort((a, b) => {
    const byRarity = rarityRank(b.rarity) - rarityRank(a.rarity)
    return byRarity !== 0 ? byRarity : a.name.localeCompare(b.name)
  })
}
