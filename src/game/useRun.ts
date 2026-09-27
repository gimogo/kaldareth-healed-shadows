/**
 * React binding for the run state machine.
 *
 * The engine is pure and knows nothing about React, so everything here is a thin
 * `useState` wrapper plus the two pieces the engine deliberately does not own:
 * combat (it needs UI input round by round) and the local token ledger.
 *
 * Runs are never implicitly saved. A run is identified by its seed, so a run can
 * always be resumed by replaying the same choices, and nothing needs to persist
 * mid-fight state that the transcript can rebuild.
 */

import { useCallback, useMemo, useState } from 'react'

import { BALANCE, COMBAT_BALANCE, DATA, ITEMS, STAT_LABELS, STORY } from '../content/content.ts'
import { createRun, currentNode, enterNode, isCombatNode, isEndingNode, resolveCombat, takeChoice, choicesOf } from '../engine/run.ts'
import type { RunContext, RunState } from '../engine/run.ts'
import { playerAct, startCombat } from '../engine/combat.ts'
import type { CombatState } from '../engine/types.ts'
import { createRng } from '../engine/rng.ts'
import type { Rng } from '../engine/rng.ts'
import type { ClassId, ItemDefinition, SkillId, TraitId } from '../engine/types.ts'

export const RUN_CONTEXT: RunContext = {
  content: STORY,
  catalog: ITEMS,
  startingTokens: BALANCE.economy.startingBalance,
  restExp: BALANCE.exp.restExp,
}

export interface CombatSession {
  state: CombatState
  rng: Rng
  nodeId: string
}

export type Phase = 'class' | 'gate' | 'play'

export interface Notice {
  tone: 'info' | 'gain' | 'block'
  text: string
}

export interface RunController {
  phase: Phase
  run: RunState | null
  combat: CombatSession | null
  notice: Notice | null
  nodeChoices: ReturnType<typeof choicesOf>
  begin: (classId: ClassId, runCode?: string) => void
  enterGate: () => void
  choose: (choiceId: string) => void
  act: (skillId: SkillId) => void
  /** Lets a child component explain a refusal without owning state. */
  setNotice: (text: string | null) => void
  dismissNotice: () => void
  abandon: () => void
}

export function useRun(): RunController {
  const [run, setRun] = useState<RunState | null>(null)
  const [combat, setCombat] = useState<CombatSession | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [phase, setPhase] = useState<Phase>('class')

  const begin = useCallback((classId: ClassId, runCode?: string) => {
    const fresh = createRun(classId, RUN_CONTEXT, runCode)
    setRun(fresh)
    setCombat(null)
    setNotice(null)
    setPhase('gate')
  }, [])

  const enterGate = useCallback(() => {
    setPhase('play')
  }, [])

  /**
   * Move onto a node, opening a fight if it is a combat node.
   *
   * A fight is initialised here rather than in a reducer so that the RNG is
   * created once per encounter and threaded explicitly: a combat that drew from
   * a shared global generator could not be replayed.
   */
  const enter = useCallback((state: RunState, nodeId: string) => {
    const result = enterNode(state, nodeId, RUN_CONTEXT)
    let next = result.run
    const messages: string[] = []

    if (result.itemsGained.length > 0) {
      const names = result.itemsGained
        .map((id) => ITEMS[id]?.name ?? id)
        .join(', ')
      messages.push(`Obtained: ${names}.`)
    }

    if (result.rest.restored && result.rest.expGained > 0) {
      messages.push(`You rest. +${result.rest.expGained} EXP.`)
    }

    const node = result.node
    if (node.type === 'combat') {
      const seed = hashOf(next.runCode, node.id)
      setCombat({ state: startCombat(next, node.enemy, COMBAT_BALANCE), rng: createRng(seed), nodeId: node.id })
    } else {
      setCombat(null)
    }

    if (messages.length > 0) {
      setNotice({ tone: 'gain', text: messages.join(' ') })
    }
    setRun(next)
    return next
  }, [])

  const choose = useCallback(
    (choiceId: string) => {
      if (!run) return
      const choice = takeChoice(run, choiceId, RUN_CONTEXT)
      if (choice.blocked) {
        setNotice({ tone: 'block', text: choice.blocked })
        return
      }
      if (choice.levelUps.length > 0) {
        setNotice({ tone: 'gain', text: `You reach level ${choice.levelUps.join(', ')}.` })
      } else {
        setNotice(null)
      }
      enter(choice.run, choice.nextNodeId)
    },
    [enter, run],
  )

  const act = useCallback(
    (skillId: SkillId) => {
      if (!run || !combat) return
      const level = run.progression.level
      const acted = playerAct(combat.state, skillId, level, COMBAT_BALANCE, combat.rng)
      const state = acted.state

      if (!state.over) {
        setCombat({ ...combat, state })
        return
      }

      // The encounter is over, so hand the result back to the run layer.
      const node = STORY.nodes[combat.nodeId]
      if (!node || node.type !== 'combat') {
        setNotice({ tone: 'block', text: `Combat node "${combat.nodeId}" is malformed.` })
        return
      }
      const resolution = resolveCombat(
        run,
        node,
        { won: state.won, playerHp: acted.playerHp, playerMaxHp: state.player.hpMax },
        RUN_CONTEXT,
      )
      setCombat(null)
      if (resolution.expGained > 0 || resolution.itemsGained.length > 0) {
        const parts: string[] = []
        if (resolution.expGained > 0) parts.push(`+${resolution.expGained} EXP`)
        if (resolution.itemsGained.length > 0) {
          parts.push(`Obtained: ${resolution.itemsGained.map((id) => ITEMS[id]?.name ?? id).join(', ')}.`)
        }
        setNotice({ tone: 'gain', text: parts.join(' ') })
      }
      enter(resolution.run, resolution.nextNodeId)
    },
    [combat, enter, run],
  )

  const nodeChoices = useMemo(() => (run ? choicesOf(run, RUN_CONTEXT) : []), [run])

  return {
    phase,
    run,
    combat,
    notice,
    nodeChoices,
    begin,
    enterGate,
    choose,
    act,
    setNotice: (text: string | null) => setNotice(text === null ? null : { tone: 'info', text }),
    dismissNotice: () => setNotice(null),
    abandon: () => {
      setRun(null)
      setCombat(null)
      setNotice(null)
      setPhase('class')
    },
  }
}

/* ── Derived view helpers ──────────────────────────────────────────────── */

export function nodeOfRun(run: RunState) {
  return currentNode(run, RUN_CONTEXT)
}

export function runIsCombat(run: RunState): boolean {
  return isCombatNode(run, RUN_CONTEXT)
}

export function runIsEnding(run: RunState): boolean {
  return isEndingNode(run, RUN_CONTEXT)
}

export function equippedItem(run: RunState): ItemDefinition | null {
  const id = run.inventory.equippedId
  return id ? (DATA.items[id] ?? null) : null
}

/** Human label for a hidden stat, from the band tables in content. */
export function traitLabel(trait: TraitId, value: number): string {
  const bands = STAT_LABELS[trait] ?? []
  let label = bands[0]?.label ?? String(value)
  for (const band of bands) {
    if (value >= band.min) label = band.label
  }
  return label
}

function hashOf(...parts: string[]): number {
  let h = 2166136261 >>> 0
  const text = parts.join('|')
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
