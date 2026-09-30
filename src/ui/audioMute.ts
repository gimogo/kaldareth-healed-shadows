/**
 * The shared sound mute.
 *
 * One switch silences everything the game makes by itself — the boards' typing
 * rattle, the scene music, the selection blip and the combat stings. It is a
 * module-level flag read at the top of every sound entry point, so flipping it
 * takes effect on the live page instantly (no rebuild, no remount); `setMuted`
 * notifies subscribers so long-running things like the music pad can fade
 * rather than just stop being re-triggered.
 */

let muted = false

const listeners = new Set<(value: boolean) => void>()

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  for (const listener of listeners) listener(value)
}

/** Subscribe to mute changes; returns the unsubscribe function. */
export function onMuteChange(listener: (value: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
