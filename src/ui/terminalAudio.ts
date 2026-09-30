/**
 * Terminal typing sounds, synthesized — no audio files.
 *
 * Each revealed line plays a short "print head" rattle: four square-wave
 * clicks, pitch snapping down, gone in under 30ms. It is the sound a line
 * printer makes finishing a row, and it matches the board's reveal cadence
 * (one rattle per line, never per glyph — 320 clicks a second is not retro,
 * it is an alarm).
 *
 * The AudioContext is created lazily and resumed on the first user gesture,
 * per browser autoplay policy: a board that renders before the player has
 * clicked anything simply stays silent until a gesture happens. Every entry
 * point is a no-op where Web Audio is missing, so an embedded webview without
 * audio can never crash the board it decorates.
 */

import { isMuted } from './audioMute.ts'

export interface TerminalAudio {
  /** Call once per newly revealed line. Silent before unlock. */
  line: () => void
  /** Registers the gesture listeners that wake the context; returns cleanup. */
  attach: () => () => void
}

/** Clicks per rattle, and the gap between them. */
const RATTLE_CLICKS = 4
const CLICK_SPACING_MS = 16
const RATTLE_GAIN = 0.05

export function createTerminalAudio(
  host: Document | undefined = typeof document === 'undefined' ? undefined : document,
): TerminalAudio {
  let ctx: AudioContext | null = null
  let unusable = false

  const context = (): AudioContext | null => {
    if (ctx !== null || unusable) return ctx
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
    if (!Ctor) {
      unusable = true
      return null
    }
    try {
      ctx = new Ctor()
    } catch {
      unusable = true
      return null
    }
    return ctx
  }

  /** One mechanical click: square wave, pitch snapping down, fast decay. */
  const click = (at: number) => {
    const audio = ctx
    if (!audio) return
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    const pitch = 1900 + Math.random() * 500
    osc.type = 'square'
    osc.frequency.setValueAtTime(pitch, at)
    osc.frequency.exponentialRampToValueAtTime(700, at + 0.025)
    gain.gain.setValueAtTime(RATTLE_GAIN, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03)
    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(at)
    osc.stop(at + 0.04)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }

  const line = () => {
    if (isMuted()) return
    const audio = context()
    // `state !== 'running'` covers both no-gesture-yet and an autoplay refusal;
    // either way the correct sound is silence, not an exception.
    if (!audio || audio.state !== 'running') return
    const start = audio.currentTime + 0.01
    for (let i = 0; i < RATTLE_CLICKS; i += 1) {
      click(start + (i * CLICK_SPACING_MS) / 1000)
    }
  }

  const attach = () => {
    if (!host) return () => {}
    const unlock = () => {
      const audio = context()
      if (audio && audio.state === 'suspended') {
        void audio.resume().catch(() => {})
      }
    }
    host.addEventListener('pointerdown', unlock, { passive: true })
    host.addEventListener('keydown', unlock, { passive: true })
    return () => {
      host.removeEventListener('pointerdown', unlock)
      host.removeEventListener('keydown', unlock)
    }
  }

  return { line, attach }
}
