/**
 * What the game frame is allowed to know about the player.
 *
 * The runtime hands the frame three things: the selected Friend's id, a fixed
 * action client, and a pause flag. That is the whole contract, and it is
 * deliberately small — the frame gets no wallet provider, no public client, no
 * signer, and no account address.
 *
 * Two consequences are recorded here rather than guessed around in the UI:
 *
 *  1. The frame never learns the canonical NFT wallet. The host resolves it and
 *     keeps it, so nothing in the frame can address funds even in principle.
 *     Quota is therefore keyed on the Friend id, which is the identity the host
 *     actually verified.
 *
 *  2. The frame never learns the Friend's generation either. The host checks
 *     `generation >= 1` at a fresh block before it mounts this frame, but it does
 *     not pass the number down. Generation-keyed daily limits (1/2/3/5/7/10) can
 *     therefore only be applied at their most conservative tier here. A player on a
 *     higher generation is never overcharged by this preview; a real tiered limit
 *     needs a server that can see the NFT, which is the on-chain phase.
 */

import type { QuotaKey } from '../economy/quota.ts'

/** Robinhood mainnet. The runtime is pinned to this chain and will not mount otherwise. */
export const CHAIN_ID = 4663

/**
 * The lowest generation the host can verify, used as the quota tier.
 *
 * The runtime guarantees `generation >= 1`, so this is not a guess about the
 * player — it is the floor of the range the host has already checked. Using the
 * floor means the frame can only ever be more restrictive than the real limit,
 * never less.
 */
export const GENERATION_FLOOR = 1

/** The verified Friend is the quota subject, not the connected account. */
export function quotaOwnerFor(friendId: bigint): QuotaKey {
  return { subject: { kind: 'friend', tokenId: friendId }, chainId: CHAIN_ID }
}

/** Display label for the verified Friend. The host shows the same string. */
export function friendLabel(friendId: bigint): string {
  return `Friend #${friendId.toString()}`
}
