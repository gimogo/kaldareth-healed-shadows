/**
 * Scene music, as one hook: call it with the mood the player is standing in.
 *
 * The bus sequences everything; this hook only re-issues the mode whenever the
 * scene changes, which is also how music resumes after the gesture unlock —
 * every node change and every combat start calls `playMusic` again, and the
 * first call that lands after unlock starts the sound.
 */

import { useEffect } from 'react'

import { gameAudio } from './audioBus.ts'
import type { MusicMode } from './gameAudio.ts'

export function useSceneMusic(mode: MusicMode): void {
  useEffect(() => {
    gameAudio().playMusic(mode)
  }, [mode])
}
