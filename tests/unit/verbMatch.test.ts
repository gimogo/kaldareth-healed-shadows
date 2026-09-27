/**
 * Free-form input.
 *
 * The contract being defended: a number is always authoritative, a clear verb
 * is honoured, a near-tie is clarified rather than guessed, and nonsense asks
 * instead of silently picking. A wrong guess costs the player a branch, so the
 * matcher is biased towards asking.
 */

import { describe, expect, it } from 'vitest'

import { STORY } from '../../src/content/content.ts'
import { matchVerb, normalize } from '../../src/engine/verbMatch.ts'
import type { MatchChoice } from '../../src/engine/verbMatch.ts'

function choicesOf(nodeId: string): MatchChoice[] {
  const node = STORY.nodes[nodeId]
  if (!node || node.type !== 'narrative') throw new Error(`fixture: ${nodeId} is not a narrative node`)
  return (node.choices ?? []).map((choice, index) => ({
    index,
    label: choice.label,
    verbs: choice.verbs,
  }))
}

const BRIDGE = choicesOf('ch1_bridge')
const DILEMMA = choicesOf('ch1_dilemma')

describe('normalize', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalize('Burn the BRIDGE!')).toBe('burn bridge')
  })

  it('drops filler words', () => {
    expect(normalize('I want to go and help her')).toBe('help')
  })

  it('keeps meaningful words that happen to be short', () => {
    expect(normalize('cut the rope')).toBe('cut rope')
  })
})

describe('numbered input', () => {
  it('treats a bare number as a position', () => {
    expect(matchVerb('2', BRIDGE)).toEqual({ kind: 'choice', index: 1, confidence: 'number' })
  })

  it('rejects an out-of-range number instead of wrapping', () => {
    expect(matchVerb('99', BRIDGE).kind).toBe('none')
  })

  it('rejects zero', () => {
    expect(matchVerb('0', BRIDGE).kind).toBe('none')
  })
})

describe('verb matching', () => {
  it('accepts a bare verb', () => {
    const result = matchVerb('cross', BRIDGE)
    expect(result.kind).toBe('choice')
  })

  it('accepts a verb inside a longer sentence', () => {
    // "cross" belongs to the ford route, not to the other two crossings.
    const result = matchVerb('I want to cross the bridge', BRIDGE)
    expect(result).toEqual({ kind: 'choice', index: 1, confidence: 'verb' })
  })

  it('inflects: "killing" reaches "kill"', () => {
    const result = matchVerb('killing the thing', DILEMMA)
    expect(result.kind).toBe('choice')
    if (result.kind === 'choice') expect(result.index).toBe(0)
  })

  it('does not match a verb the choice does not have', () => {
    // "burn" is not a verb on the destroy route; guessing it would be a coin flip.
    expect(matchVerb('burning it down', DILEMMA).kind).toBe('none')
  })

  it('does not strip "s" from a word already ending in "ss"', () => {
    expect(normalize('pass the gate')).toBe('pass gate')
  })

  it('falls back to the choice label when no verb matches', () => {
    // "beams" appears only in the label, never in the verb list.
    const result = matchVerb('beams', BRIDGE)
    expect(result).toEqual({ kind: 'choice', index: 0, confidence: 'overlap' })
  })
})

describe('refusing to guess', () => {
  it('asks rather than choosing when nothing resembles a choice', () => {
    const result = matchVerb('dance on the roof', BRIDGE)
    expect(result.kind).toBe('none')
    if (result.kind === 'none') expect(result.candidates.length).toBe(BRIDGE.length)
  })

  it('asks when two choices are equally close', () => {
    // Both bridge routes share "cross"; the disambiguation must surface both.
    const tie = [
      { index: 0, label: 'Cross the bridge', verbs: ['cross'] },
      { index: 1, label: 'Cross the far side', verbs: ['cross'] },
    ]
    expect(matchVerb('cross', tie).kind).toBe('ambiguous')
  })

  it('asks on empty input', () => {
    expect(matchVerb('   ', BRIDGE).kind).toBe('none')
  })
})

describe('real chapter 1 nodes', () => {
  it('routes a bare "rescue" to the rescue choice', () => {
    const result = matchVerb('rescue', DILEMMA)
    expect(result).toEqual({ kind: 'choice', index: 1, confidence: 'verb' })
  })

  it('routes "end the monster" to the destroy choice', () => {
    const result = matchVerb('end the monster', DILEMMA)
    expect(result.kind).toBe('choice')
    if (result.kind === 'choice') expect(result.index).toBe(0)
  })

  it('always offers a resolution for every choice position', () => {
    for (let i = 0; i < BRIDGE.length; i += 1) {
      expect(matchVerb(String(i + 1), BRIDGE)).toEqual({
        kind: 'choice',
        index: i,
        confidence: 'number',
      })
    }
  })
})
