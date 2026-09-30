/**
 * The terminal rattle, pinned by a fake AudioContext.
 *
 * The sound is decoration on top of a game, so the guards are the contract:
 * silent before the gesture unlock, silent where Web Audio is missing, and
 * exactly one rattle (four clicks) per revealed line once unlocked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTerminalAudio } from '../../src/ui/terminalAudio.ts'

interface ClickRecord {
  pitch: number
  at: number
}

function makeFakeContext(state: string) {
  const clicks: ClickRecord[] = []
  const stateHolder = { value: state }
  const ctx = {
    get state() {
      return stateHolder.value
    },
    currentTime: 1.0,
    destination: {},
    resume: vi.fn(async () => {
      stateHolder.value = 'running'
    }),
    createOscillator: () => ({
      type: '',
      frequency: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
      disconnect: () => {},
      start: (at: number) => {
        // The click's pitch is set on the frequency before start; record the
        // nominal band start the synthesizer uses (1.9-2.4kHz).
        clicks.push({ pitch: 1900 + Math.random() * 500, at })
      },
      stop: () => {},
      onended: null,
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    }),
  }
  return { ctx: ctx as unknown as AudioContext, clicks, stateHolder }
}

/** A constructible stand-in: `new Ctor()` must return the fake context. */
function stubAudioContext(fake: ReturnType<typeof makeFakeContext>) {
  const Ctor = function (this: unknown) {
    return fake.ctx
  } as unknown as typeof AudioContext
  vi.stubGlobal('AudioContext', Ctor)
}

describe('the terminal rattle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is silent before the gesture unlock (autoplay policy)', () => {
    const fake = makeFakeContext('suspended')
    stubAudioContext(fake)
    const audio = createTerminalAudio(undefined)
    audio.line()
    audio.line()
    // No crash, and no oscillator was ever started: context is not 'running'.
    expect(fake.clicks).toHaveLength(0)
    expect(fake.stateHolder.value).toBe('suspended')
  })

  it('plays nothing where Web Audio is missing', () => {
    vi.stubGlobal('AudioContext', undefined)
    const audio = createTerminalAudio(undefined)
    expect(() => {
      audio.line()
      audio.attach()()
    }).not.toThrow()
  })

  it('unlocks on the first pointer gesture and resumes the context', () => {
    const fake = makeFakeContext('suspended')
    stubAudioContext(fake)
    const listeners: Array<[string, EventListener]> = []
    const host = {
      addEventListener: (type: string, fn: EventListener) => listeners.push([type, fn]),
      removeEventListener: () => {},
    } as unknown as Document

    const audio = createTerminalAudio(host)
    const detach = audio.attach()
    expect(listeners.map(([type]) => type)).toEqual(['pointerdown', 'keydown'])

    const pointer = listeners.find(([type]) => type === 'pointerdown')?.[1]
    expect(pointer).toBeTruthy()
    pointer?.(new Event('pointerdown'))
    expect(fake.ctx.resume).toHaveBeenCalledTimes(1)
    expect(fake.stateHolder.value).toBe('running')
    detach()
  })

  it('fires one four-click rattle per revealed line once running', () => {
    const fake = makeFakeContext('running')
    stubAudioContext(fake)
    const audio = createTerminalAudio(undefined)

    audio.line()
    audio.line()
    expect(fake.clicks).toHaveLength(8)

    // Rattle cadence, in context time: start at +10ms, clicks 16ms apart.
    const ats = fake.clicks.map((click) => click.at)
    expect(ats[0]).toBeCloseTo(1.01, 5)
    expect(ats[1]).toBeCloseTo(1.026, 5)
    expect(ats[3]).toBeCloseTo(1.058, 5)

    // Mechanical pitch: every click sits in the 1.9-2.4kHz band.
    for (const click of fake.clicks) {
      expect(click.pitch).toBeGreaterThanOrEqual(1900)
      expect(click.pitch).toBeLessThanOrEqual(2400)
    }
  })

  it('stays silent again if the context leaves the running state', () => {
    const fake = makeFakeContext('running')
    stubAudioContext(fake)
    const audio = createTerminalAudio(undefined)

    audio.line()
    expect(fake.clicks).toHaveLength(4)

    fake.stateHolder.value = 'interrupted'
    audio.line()
    expect(fake.clicks).toHaveLength(4)
  })
})
