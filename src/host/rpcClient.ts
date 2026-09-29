/**
 * Read-only RPC client for the host, with a workaround for the public Robinhood
 * RPC's `eth_getLogs` limits.
 *
 * The default `GENERATION_SPRITE_MANIFEST.rpcUrl` refuses a log query that spans
 * more than 10,000,000 blocks, and the chain is past 75,000,000 — so the SDK's
 * owner-filtered Transfer discovery (which asks from block 0) fails with
 * "query spans ... narrow the block range" and no Friends ever load. Verified
 * against the live RPC on 2026-09-29.
 *
 * Two measurements, both taken from this machine on the same day, make the
 * workaround honest rather than a guess:
 *
 *  - `eth_getLogs` over the Generations contract for blocks 0-62,999,999 returns
 *    zero logs in every 1M-block window — the contract simply had no activity
 *    before block ~63,000,000. Skipping that history cannot lose a Transfer.
 *  - Owner-filtered queries are small; only whole-collection scans exceed the
 *    10,000-log result cap. The SDK never does a whole-collection scan (it
 *    refuses to by design), so every query the SDK makes fits one chunk.
 *
 * Everything else (`readContract`, `getBlockNumber`, `getChainId`) is passed
 * straight through to a stock viem public client. The wallet connection itself
 * is untouched: the injected provider talks to the user's own wallet endpoints.
 */

import { createPublicClient, http } from 'viem'
import type { GameHostProps } from '@rarefriends/friendsdk/runtime'

/** The RPC's documented limit: `query spans ... only 10000000 are allowed`. */
const RPC_GETLOGS_BLOCK_LIMIT = 10_000_000n

/**
 * First block with any Generations activity (measured: every 1M window below
 * this is empty). Querying from here instead of 0 is invisible to the SDK.
 */
const KNOWN_ACTIVITY_START = 63_000_000n

export function createHostPublicClient(rpcUrl = 'https://rpc.mainnet.chain.robinhood.com') {
  const inner = createPublicClient({ transport: http(rpcUrl, { retryCount: 1, timeout: 20_000 }) })

  // A plain object, not a spread of viem's PublicClient: the SDK bundles its
  // own viem copy, so carrying this project's PublicClient *type* into the
  // `publicClient` prop produces irreconcilable duplicate-generic errors. The
  // OwnedFriendsClient contract is four methods; these are those four methods.
  const client = {
    getLogs: (async (args?: { fromBlock?: unknown; toBlock?: unknown }): Promise<unknown> => {
      const requestedFrom = typeof args?.fromBlock === 'bigint' ? args.fromBlock : 0n
      const requestedTo = typeof args?.toBlock === 'bigint' ? args.toBlock : await inner.getBlockNumber()

      // Never ask about blocks before the contract existed. If the caller's
      // range starts after this, leave it alone.
      const boundedFrom = requestedFrom > KNOWN_ACTIVITY_START ? requestedFrom : requestedTo > KNOWN_ACTIVITY_START ? KNOWN_ACTIVITY_START : requestedFrom
      if (boundedFrom > requestedTo) return []

      const results: unknown[] = []
      for (let from = boundedFrom; from <= requestedTo; from += RPC_GETLOGS_BLOCK_LIMIT) {
        const to = from + RPC_GETLOGS_BLOCK_LIMIT - 1n > requestedTo ? requestedTo : from + RPC_GETLOGS_BLOCK_LIMIT - 1n
        const chunk = (inner.getLogs as (a: object) => Promise<unknown[]>)(
          typeof args === 'object' && args !== null ? { ...args, fromBlock: from, toBlock: to } : { fromBlock: from, toBlock: to },
        )
        results.push(...(await chunk))
      }
      return results
    }) as unknown as typeof inner.getLogs,
    readContract: inner.readContract,
    getBlockNumber: inner.getBlockNumber,
    getChainId: inner.getChainId,
  }
  // Cast to the SDK's own OwnedFriendsClient type (via GameHostProps): the SDK
  // bundles its own viem copy, so its Pick<PublicClient, ...> is a distinct
  // nominal type from this project's, and only its own types line up.
  return client as unknown as NonNullable<GameHostProps['publicClient']>
}
