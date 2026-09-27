/**
 * The runtime's required reference definition.
 *
 * The FriendSDK runtime validates a `ChanceGameDefinition` before it will mount a
 * game, even though Kaldareth has no consumable economy: the runtime exists to
 * host a chance game, and it does not special-case a game that declines to use one.
 *
 * So the runtime gets a definition, and this module is where the honesty about it
 * lives. The definition is parsed by the SDK's own parser — the same code the
 * runtime runs — so the browser cannot be handed a shape the runtime would reject.
 *
 * Kaldareth never calls `buy`, `play`, `settle` or `redeem`. Its entry fee, fee
 * split and weekly prize pool are simulated in `src/economy/ledger.ts` from
 * `content/balance.json`, and the weekly settlement is a leaderboard, not a
 * weighted roll. Nothing in this file is a real price, a real payout, or an RF
 * redemption promise; `scripts/check-sdk-boundary.mjs` asserts that the game
 * layer never touches the consumable actions, so the "unused" claim is checked
 * rather than asserted in a comment.
 */

import { parseChanceGame } from '@rarefriends/friendsdk/game'
import type { ChanceGameDefinition } from '@rarefriends/friendsdk/game'

import rawReference from '../../content/kaldareth.game.json'

/** 18-decimal RF base units per whole token. */
export const RF_DECIMALS = 18n

export const REFERENCE_GAME: ChanceGameDefinition = parseChanceGame(rawReference)

/** Whole-token amount as RF base units, for comparing against the simulated split. */
export function rfBaseUnits(whole: number): bigint {
  return BigInt(whole) * 10n ** RF_DECIMALS
}
