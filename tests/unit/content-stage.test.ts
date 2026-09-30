/**
 * The stage axis now means "chapter number".
 *
 * The play banner shows the current chapter live, and the refund rule reads a
 * run's stage, so the content's stage values are load-bearing: every node
 * carries the chapter it belongs to. This pins that convention — a node id of
 * `ch12_something` must have `stage: 12` — so a hand-written node cannot
 * silently strand a player on the wrong chapter label.
 */

import { describe, expect, it } from 'vitest'

import { STORY } from '../../src/content/content.ts'

describe('per-chapter stages', () => {
  it('gives every node the chapter its id names', () => {
    // The Litany Echo nodes are chapter-anchored by design (litany_5 rides
    // Chapter 20), so they are exempt from the id/stage convention.
    const wrong = Object.entries(STORY.nodes).filter(([id, node]) => {
      if (id.startsWith('litany_')) return false
      const chapter = Number.parseInt(/^ch(\d+)_/.exec(id)?.[1] ?? '', 10)
      return node.stage !== chapter
    })
    expect(wrong.map(([id]) => id)).toEqual([])
  })

  it('starts the run in Chapter 1 and ends it in Chapter 32', () => {
    const stages = Object.values(STORY.nodes).map((node) => node.stage)
    expect(Math.min(...stages)).toBe(1)
    expect(Math.max(...stages)).toBe(32)
    expect(STORY.nodes.ch1_open?.stage).toBe(1)
    expect(STORY.nodes.ch32_kaldareth_healed?.stage).toBe(32)
  })

  it('covers every chapter from 1 to 32 with at least one node', () => {
    const seen = new Set(Object.values(STORY.nodes).map((node) => node.stage))
    for (let chapter = 1; chapter <= 32; chapter += 1) {
      expect(seen.has(chapter), `chapter ${chapter} has no nodes`).toBe(true)
    }
  })
})
