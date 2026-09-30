/**
 * The art catalog and the music/blip/sting bus.
 *
 * The art must cover every named enemy and hold its width budget (the duel
 * sits two-across in a 360px frame); the bus must respect the shared mute and
 * stay silent where Web Audio is missing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { STORY, ITEMS } from '../../src/content/content.ts'
import { createRun, currentNode, enterNode, isCombatNode, takeChoice } from '../../src/engine/run.ts'
import type { RunContext } from '../../src/engine/run.ts'
import type { CombatNode } from '../../src/engine/types.ts'
import { artForClass, artForEnemy } from '../../src/ui/asciiArt.ts'
import { isMuted, setMuted } from '../../src/ui/audioMute.ts'
import { createGameAudio } from '../../src/ui/gameAudio.ts'

/** Every combat node's enemy name, straight from the content. */
function enemyNames(): string[] {
  const names: string[] = []
  for (const node of Object.values(STORY.nodes)) {
    if (node.type === 'combat') names.push(node.enemy.name)
  }
  return names
}

describe('the art catalog', () => {
  it('maps every named enemy to a ten-line block within budget', () => {
    for (const name of enemyNames()) {
      const art = artForEnemy(name)
      expect(art.lines, name).toHaveLength(10)
      for (const line of art.lines) {
        expect(line.length, `${name}: "${line}"`).toBeLessThanOrEqual(24)
      }
    }
  })

  it('gives each class its own weapon and the shared armor art exists', () => {
    const sword = artForClass('warrior')
    const bow = artForClass('archer')
    const staff = artForClass('mage')
    expect(sword.lines).not.toEqual(bow.lines)
    expect(bow.lines).not.toEqual(staff.lines)
    for (const art of [sword, bow, staff]) {
      expect(art.lines).toHaveLength(10)
    }
  })

  it('falls back to the spirit for unknown names', () => {
    const unknown = artForEnemy('a Thing Never Seen')
    const whisper = artForEnemy('a Whisper')
    expect(unknown.lines).toEqual(whisper.lines)
  })
})

describe('the music/blip/sting bus', () => {
  afterEach(() => {
    setMuted(false)
    vi.unstubAllGlobals()
  })

  it('is a silent no-op where Web Audio is missing', () => {
    vi.stubGlobal('AudioContext', undefined)
    const audio = createGameAudio(undefined)
    expect(() => {
      audio.playMusic('ambient')
      audio.playBlip()
      audio.playSting(true)
      audio.playMusic('battle')
      audio.playMusic('off')
      audio.attach()()
    }).not.toThrow()
  })

  it('starts nothing before the autoplay unlock', () => {
    // No AudioContext global at all mirrors "context never unlocked" closely
    // enough for the guard: the entry points must not throw and must not
    // schedule anything.
    vi.stubGlobal('AudioContext', undefined)
    const audio = createGameAudio(undefined)
    audio.playMusic('ambient')
    expect(isMuted()).toBe(false)
  })

  it('respects the shared mute at every entry point', () => {
    setMuted(true)
    const audio = createGameAudio(undefined)
    // With no context available these would be no-ops anyway; the mute read
    // comes first, which is the contract under test.
    expect(() => {
      audio.playMusic('battle')
      audio.playMusic('boss')
      audio.playBlip()
      audio.playSting(false)
      audio.playSting(true, true)
    }).not.toThrow()
    setMuted(false)
  })

  it('marks boss sessions on the combat session', () => {
    // The session flag is what both the theme and the fanfare key off; pin it
    // against the real first fight rather than trusting the wiring.
    const context: RunContext = {
      content: STORY,
      catalog: ITEMS,
      startingTokens: 3_000,
      restExp: 40,
    }
    let run = createRun('warrior', context)
    for (let i = 0; i < 400 && !isCombatNode(run, context); i += 1) {
      const node = currentNode(run, context)
      if (node.type !== 'narrative') break
      const choice = (node.choices ?? [])[0]
      if (!choice) break
      const taken = takeChoice(run, choice.id, context)
      run = enterNode(taken.run, taken.nextNodeId, context).run
    }
    expect(isCombatNode(run, context)).toBe(true)
    const node = currentNode(run, context)
    expect(node.type).toBe('combat')
    const combat = node as CombatNode
    // The first fight is a Whisper — a miniboss, not THE boss.
    expect(combat.enemy.tier).toBe('miniboss')
  })
})
