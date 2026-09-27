/**
 * The child document entry: the game, inside the sandbox.
 *
 * `GameSession` performs the handshake with the host and hands the verified
 * session to our component. Everything above this line is game code; everything
 * the wallet needs stays in the host document.
 *
 * There is no `StrictMode` here on purpose. Its double-invoked effects would run
 * the bridge handshake twice in development, and a bridge that initialises twice
 * is a bridge that a reviewer has to read twice.
 */

import { createRoot } from 'react-dom/client'
import { GameSession } from '@rarefriends/friendsdk/runtime'

import { REFERENCE_GAME } from '../content/referenceGame.ts'
import KaldarethGame from './KaldarethGame.tsx'

import '../index.css'
import './frame.css'

createRoot(document.getElementById('root')!).render(
  <GameSession definition={REFERENCE_GAME}>{(props) => <KaldarethGame {...props} />}</GameSession>,
)
