/**
 * The audio singletons.
 *
 * One AudioContext serves everything — typing rattle, scene music, blips,
 * stings — created lazily on first use and shared for the page's lifetime.
 * Components never construct audio; they ask for the bus, and the gesture
 * unlock (pointerdown/keydown) is registered once at the App root.
 */

import { createGameAudio } from './gameAudio.ts'
import type { GameAudio } from './gameAudio.ts'
import { createTerminalAudio } from './terminalAudio.ts'
import type { TerminalAudio } from './terminalAudio.ts'

let terminal: TerminalAudio | null = null
let game: GameAudio | null = null

/** The boards' typing rattle. */
export function terminalAudio(): TerminalAudio {
  if (!terminal) terminal = createTerminalAudio()
  return terminal
}

/** Music, blips and stings. */
export function gameAudio(): GameAudio {
  if (!game) game = createGameAudio()
  return game
}

/** Register the gesture unlock on the document; call once from the App root. */
export function attachAudio(host: Document | undefined): () => void {
  const detachTerminal = terminalAudio().attach()
  const detachGame = gameAudio().attach()
  void host
  return () => {
    detachTerminal()
    detachGame()
  }
}
