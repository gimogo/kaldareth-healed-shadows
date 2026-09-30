/**
 * The game's music and effect bus, synthesized — no audio files.
 *
 * Two moods, sequenced live from the scene the player is standing in:
 *
 *  - `ambient` (narrative nodes): a slow low pad — root/fifth/octave around
 *    110 Hz, triangle waves swelling in over seconds — plus sparse random
 *    wind tones. It should feel like weather, not a song.
 *  - `battle` (combat nodes): a pulsing eighth-note bassline, square wave,
 *    with a hard tick on every step. It should feel like a drum, not a tune.
 *
 * Crossing into combat raises the tension; crossing into a *boss* fight
 * raises it further — a faster, higher, denser pulse. Combat resolution
 * stings: three rising notes for a win, three falling ones for a loss, and a
 * six-note fanfare when the fallen one was a boss. `playBlip()` is the
 * one-click acknowledgement of a chosen answer.
 *
 * Every entry point respects the shared mute and the browser's autoplay
 * policy (the context stays suspended until a user gesture — the terminal
 * rattle's unlock already handles that). Where Web Audio is missing, every
 * function is a silent no-op.
 */

import { isMuted } from './audioMute.ts'

export type MusicMode = 'ambient' | 'battle' | 'boss' | 'off'

export interface GameAudio {
  /** Cross-fade the scene music. */
  playMusic: (mode: MusicMode) => void
  /** One soft blip: a chosen answer. */
  playBlip: () => void
  /** Three rising (won) or falling (lost) notes; a fanfare/dirge for bosses. */
  playSting: (won: boolean, boss?: boolean) => void
  /** Registers the gesture unlock listeners; returns cleanup. */
  attach: () => () => void
}

const AMBIENT_ROOT_HZ = 110
const BATTLE_STEP_MS = 240
const BOSS_STEP_MS = 175
const BLIP_HZ = 660
const STING_MS = 95

export function createGameAudio(
  host: Document | undefined = typeof document === 'undefined' ? undefined : document,
): GameAudio {
  let ctx: AudioContext | null = null
  let unusable = false

  let padNodes: { osc: OscillatorNode[]; gain: GainNode } | null = null
  let windTimer: ReturnType<typeof setInterval> | null = null
  let battleTimer: ReturnType<typeof setInterval> | null = null
  let battleStep = 0
  let currentMode: MusicMode = 'off'

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

  const stopMusic = (): void => {
    const audio = ctx
    if (battleTimer !== null) {
      clearInterval(battleTimer)
      battleTimer = null
    }
    if (windTimer !== null) {
      clearInterval(windTimer)
      windTimer = null
    }
    if (padNodes && audio) {
      const now = audio.currentTime
      padNodes.gain.gain.cancelScheduledValues(now)
      padNodes.gain.gain.setTargetAtTime(0.0001, now, 0.08)
      for (const osc of padNodes.osc) osc.stop(now + 0.4)
      padNodes = null
    }
    currentMode = 'off'
  }

  /** One enveloped note on the running context. */
  const note = (
    freq: number,
    at: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ): void => {
    const audio = ctx
    if (!audio) return
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.02, duration / 4))
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(at)
    osc.stop(at + duration + 0.05)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }

  const startAmbient = (): void => {
    const audio = ctx
    if (!audio) return
    const now = audio.currentTime
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.035, now + 2.5)
    gain.connect(audio.destination)
    // Root / fifth / octave, detuned a hair apart so the pad breathes.
    const osc = [1, 1.5, 2].map((multiple, index) => {
      const node = audio.createOscillator()
      node.type = 'triangle'
      node.frequency.setValueAtTime(AMBIENT_ROOT_HZ * multiple + (index - 1) * 0.7, now)
      node.connect(gain)
      node.start(now)
      return node
    })
    padNodes = { osc, gain }
    // Sparse wind: a random high triangle, a few seconds apart.
    windTimer = setInterval(() => {
      if (isMuted() || !ctx) return
      const wind = ctx.currentTime
      note(400 + Math.random() * 500, wind, 1.6, 'triangle', 0.012)
    }, 5_200)
  }

  const startBattle = (): void => {
    const audio = ctx
    if (!audio) return
    const line = [110, 110, 165, 110, 147, 110, 165, 220]
    battleStep = 0
    const step = () => {
      if (isMuted() || !ctx) return
      const hz = line[battleStep % line.length] ?? 110
      note(hz, ctx.currentTime + 0.01, 0.11, 'square', 0.03)
      if (battleStep % 4 === 0) note(2_200, ctx.currentTime + 0.01, 0.03, 'square', 0.015)
      battleStep += 1
    }
    step()
    battleTimer = setInterval(step, BATTLE_STEP_MS)
  }

  /**
   * The boss theme: the battle pulse, tightened to 175ms, a semitone-shifted
   * line that never resolves home, and a fifth-stab over every beat — dense
   * enough that the room changes when the big fight starts.
   */
  const startBoss = (): void => {
    const audio = ctx
    if (!audio) return
    const line = [110, 117, 110, 131, 110, 117, 147, 131, 110, 117, 131, 165, 147, 131, 117, 175]
    battleStep = 0
    const step = () => {
      if (isMuted() || !ctx) return
      const hz = line[battleStep % line.length] ?? 110
      note(hz, ctx.currentTime + 0.01, 0.09, 'square', 0.032)
      // The stab sits a fifth above the beat note — a second voice.
      if (battleStep % 2 === 0) note(hz * 1.5, ctx.currentTime + 0.01, 0.06, 'square', 0.018)
      if (battleStep % 4 === 0) note(2_600, ctx.currentTime + 0.01, 0.03, 'square', 0.014)
      battleStep += 1
    }
    step()
    battleTimer = setInterval(step, BOSS_STEP_MS)
  }

  const playMusic = (mode: MusicMode): void => {
    if (mode === currentMode) return
    if (isMuted()) {
      stopMusic()
      return
    }
    const audio = context()
    if (!audio || audio.state !== 'running') {
      // Not unlocked yet: remember the intent and stop. The next call after the
      // gesture unlock (every node change re-issues it) will start the music.
      stopMusic()
      return
    }
    stopMusic()
    currentMode = mode
    if (mode === 'ambient') startAmbient()
    if (mode === 'battle') startBattle()
    if (mode === 'boss') startBoss()
  }

  const playBlip = (): void => {
    if (isMuted()) return
    const audio = context()
    if (!audio || audio.state !== 'running') return
    note(BLIP_HZ, audio.currentTime + 0.005, 0.06, 'square', 0.04)
  }

  const playSting = (won: boolean, boss = false): void => {
    if (isMuted()) return
    const audio = context()
    if (!audio || audio.state !== 'running') return
    const start = audio.currentTime + 0.01
    if (won && boss) {
      // The boss is down: a six-note fanfare, rising through the triad and
      // held at the octave — the one moment the game lets itself celebrate.
      const fanfare = [392, 494, 587, 784, 988, 1_175]
      fanfare.forEach((freq, index) =>
        note(freq, start + (index * STING_MS) / 1000, index === fanfare.length - 1 ? 0.5 : 0.16, 'square', 0.05),
      )
      return
    }
    if (!won && boss) {
      // Felled by the boss: three heavy falling notes, longer and darker.
      const dirge = [220, 175, 131]
      dirge.forEach((freq, index) => note(freq, start + index * 0.22, 0.4, 'square', 0.05))
      return
    }
    const rise = [392, 494, 587]
    const fall = [440, 349, 262]
    const line = won ? rise : fall
    line.forEach((freq, index) => note(freq, start + (index * STING_MS) / 1000, 0.14, 'square', 0.045))
  }

  const attach = (): (() => void) => {
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

  return { playMusic, playBlip, playSting, attach }
}
