/**
 * The trusted host document: wallet, Friend discovery, verification, frame.
 *
 * This is the only entry point that talks to the runtime's connection and
 * ownership machinery, and it contains no game code. The game is a separate
 * document loaded into a sandboxed iframe pointed at by `frameUrl`, so a
 * community-game bug cannot reach the wallet that holds the NFT.
 *
 * No `deployment` prop is passed, so every action is simulated: the prototype
 * ships with a real ownership gate and no on-chain writes.
 *
 * There is no `StrictMode` here for the same reason as in the child: the host
 * owns the bridge, and a double-invoked bridge handshake is not something to
 * read twice.
 */

import { createRoot } from 'react-dom/client'
import { GameHost } from '@rarefriends/friendsdk/runtime'

import { REFERENCE_GAME } from '../content/referenceGame.ts'
import { createHostPublicClient } from './rpcClient.ts'

import '@rarefriends/friendsdk/frame.css'
import '@rarefriends/friendsdk/runtime.css'
import './host.css'

/*
 * The public Robinhood RPC caps `eth_getLogs` at a 10M-block span, which the
 * SDK's owner-filtered Transfer discovery exceeds when it asks from block 0.
 * The override skips the contract's provably empty early history and chunks the
 * rest; see rpcClient.ts for the measurements that make that safe.
 */
const publicClient = createHostPublicClient()

createRoot(document.getElementById('root')!).render(
  <GameHost definition={REFERENCE_GAME} frameUrl="./frame.html" publicClient={publicClient} />,
)
