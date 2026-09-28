/**
 * Run state machine.
 *
 * A run is a walk over the node tree. Every mutation goes through `enterNode`
 * or `takeChoice`, both of which are pure and both of which refuse to act on a
 * finished run — that is the whole integrity model: content cannot drive the
 * engine into an illegal state, it can only ask.
 *
 * HP lives outside RunState on purpose. It is a combat-local pool, so it is
 * carried in the CombatState and written back only at encounter boundaries.
 * That keeps a long narrative stretch from silently healing anyone.
 */

import { applyEffects } from './effects.ts'
import type { ItemCatalog } from './items.ts'
import { initialProgression } from './progression.ts'
import { createRunIdentity } from './rng.ts'
import { evaluateChoices } from './requirements.ts'
import type { ChoiceAvailability, RequirementContext } from './requirements.ts'
import { totalStats } from './stats.ts'
import type {
  ClassId,
  CombatNode,
  ContentNode,
  EndingNode,
  NarrativeNode,
  RunState,
  StoryContent,
} from './types.ts'

/* ── Context ──────────────────────────────────────────────────────────── */

export interface RunContext {
  content: StoryContent
  catalog: ItemCatalog
  /** Starting balance. Purely simulated; see economy/ledger.ts. */
  startingTokens?: number
  /** EXP granted by a rest beat, on top of the resource top-up. */
  restExp?: number
}

export const DEFAULT_STARTING_TOKENS = 3000
export const DEFAULT_REST_EXP = 40

/* Re-exported so callers can name the state type without reaching past this
   module into types.ts just to get one identifier. */
export type { RunState } from './types.ts'

function nodeOf(content: StoryContent, id: string): ContentNode {
  const node = content.nodes[id]
  if (!node) throw new Error(`run: no node with id "${id}"`)
  return node
}

function isNarrative(node: ContentNode): node is NarrativeNode {
  return node.type === 'narrative'
}

function isCombat(node: ContentNode): node is CombatNode {
  return node.type === 'combat'
}

function isEnding(node: ContentNode): node is EndingNode {
  return node.type === 'ending'
}

/* ── Construction ─────────────────────────────────────────────────────── */

export function createRun(classId: ClassId, ctx: RunContext, runCode?: string): RunState {
  const identity = createRunIdentity(runCode)
  const start = nodeOf(ctx.content, ctx.content.meta.start)
  const stats = totalStats(classId, 1, { items: [], equippedId: null })
  return {
    seed: identity.seed,
    runCode: identity.runCode,
    classId,
    progression: initialProgression(),
    stats,
    currentHp: stats.hp,
    traits: { courage: 0, reputation: 0, royal_loyalty: 0 },
    flags: new Set<string>(),
    inventory: { items: [], equippedId: null },
    tokens: ctx.startingTokens ?? DEFAULT_STARTING_TOKENS,
    visited: [start.id],
    stage: start.stage,
    currentNodeId: start.id,
    transcript: [],
    finished: false,
    combatsWon: 0,
    choicesMade: 0,
  }
}

/* ── Reading a node ───────────────────────────────────────────────────── */

export interface EnterResult {
  run: RunState
  node: ContentNode
  /** True when this node was entered for the first time. */
  firstVisit: boolean
  rest: { restored: boolean; expGained: number }
  itemsGained: string[]
}

/** Move the run onto a node, applying its `onEnter` effects exactly once. */
export function enterNode(run: RunState, nodeId: string, ctx: RunContext): EnterResult {
  if (run.finished) throw new Error(`run: "${run.runCode}" has already finished`)
  const node = nodeOf(ctx.content, nodeId)
  const firstVisit = !run.visited.includes(nodeId)

  let next = run
  let itemsGained: string[] = []
  if (firstVisit) {
    const result = applyEffects(
      { ...run, visited: [...run.visited, nodeId], currentNodeId: nodeId, stage: Math.max(run.stage, node.stage) },
      node.onEnter ?? [],
      ctx.catalog,
    )
    next = result.run
    itemsGained = result.itemsGained
    if (result.levelsGained.length > 0) {
      next = { ...next, transcript: [...next.transcript, `You reach level ${result.levelsGained.join(', ')}.`] }
    }
    if (isEnding(node)) {
      next = {
        ...next,
        finished: true,
        endingId: node.id,
        rewardModifier: node.reward_modifier,
        leaderboardTag: node.leaderboard_tag,
      }
    }
    if (itemsGained.length > 0) {
      next = { ...next, transcript: [...next.transcript, `Obtained: ${itemsGained.join(', ')}.`] }
    }
  }

  // Rest EXP is paid by the run layer, not restated as a content effect in each
  // node, so every rest beat pays the same amount by construction. Rest also
  // heals to full: it is the only free recovery in Act 1, and a rest beat that
  // gave EXP but no health would be a trap.
  const isRest = isNarrative(node) && node.rest === true
  const expGained = isRest ? (ctx.restExp ?? DEFAULT_REST_EXP) : 0
  if (isRest) {
    const { run: afterRest, levelsGained } = applyEffects(next, [{ op: 'exp', amount: expGained }], ctx.catalog)
    const healed = afterRest.currentHp < afterRest.stats.hp
    next = healed ? { ...afterRest, currentHp: afterRest.stats.hp } : afterRest
    if (healed) {
      next = { ...next, transcript: [...next.transcript, 'You rest, and your wounds close.'] }
    }
    if (levelsGained.length > 0) {
      next = { ...next, transcript: [...next.transcript, `You reach level ${levelsGained.join(', ')}.`] }
    }
  }

  return { run: next, node, firstVisit, rest: { restored: isRest, expGained }, itemsGained }
}

/* ── Choices ──────────────────────────────────────────────────────────── */

export function requirementContextOf(run: RunState): RequirementContext {
  return {
    traits: run.traits,
    flags: run.flags,
    inventory: run.inventory,
    classId: run.classId,
    level: run.progression.level,
  }
}

export function choicesOf(run: RunState, ctx: RunContext): ChoiceAvailability[] {
  const node = nodeOf(ctx.content, run.currentNodeId)
  if (!isNarrative(node)) return []
  return evaluateChoices(node.choices ?? [], requirementContextOf(run))
}

export interface ChoiceResult {
  run: RunState
  nextNodeId: string
  /** Set when the choice was locked, so the UI can say why and stop. */
  blocked: string | null
  itemsGained: string[]
  levelUps: number[]
}

/** Apply a choice's effects and report where it leads. */
export function takeChoice(run: RunState, choiceId: string, ctx: RunContext): ChoiceResult {
  if (run.finished) throw new Error(`run: "${run.runCode}" has already finished`)
  const node = nodeOf(ctx.content, run.currentNodeId)
  if (!isNarrative(node)) {
    throw new Error(`run: node "${node.id}" is ${node.type} and has no choices`)
  }

  const choice = (node.choices ?? []).find((c) => c.id === choiceId)
  if (!choice) throw new Error(`run: node "${node.id}" has no choice "${choiceId}"`)

  const availability = evaluateChoices([choice], requirementContextOf(run))[0]
  if (availability && !availability.enabled) {
    return { run, nextNodeId: node.id, blocked: availability.reason, itemsGained: [], levelUps: [] }
  }

  const { run: afterChoice, levelsGained, itemsGained } = applyEffects(
    { ...run, choicesMade: run.choicesMade + 1 },
    choice.effects ?? [],
    ctx.catalog,
  )

  const withNote: RunState = {
    ...afterChoice,
    transcript: [...afterChoice.transcript, `You chose: ${choice.label}`],
  }

  return { run: withNote, nextNodeId: choice.next, blocked: null, itemsGained, levelUps: levelsGained }
}

/* ── Combat boundaries ────────────────────────────────────────────────── */

export interface CombatResolution {
  run: RunState
  nextNodeId: string
  expGained: number
  levelUps: number[]
  itemsGained: string[]
}

export interface CombatOutcome {
  won: boolean
  playerHp: number
  playerMaxHp: number
}

/**
 * Bank HP, then follow `onWin` or `onLose`.
 *
 * Resource is deliberately not banked: it is a within-encounter pool, so each
 * fight starts from full. That is what makes a Warrior's opening turn a real
 * decision instead of a continuation of the last one.
 */
export function resolveCombat(
  run: RunState,
  node: CombatNode,
  outcome: CombatOutcome,
  ctx: RunContext,
): CombatResolution {
  const bankedHp = Math.min(outcome.playerMaxHp, Math.max(0, Math.round(outcome.playerHp)))
  const banked: RunState = { ...run, currentHp: bankedHp }

  const target = outcome.won ? node.onWin : node.onLose
  const { run: afterEffects, levelsGained, itemsGained } = applyEffects(
    { ...banked, combatsWon: banked.combatsWon + (outcome.won ? 1 : 0) },
    target.effects ?? [],
    ctx.catalog,
  )

  /*
   * The fight's EXP pays on BOTH branches, not just the win. These are
   * mandatory, sequential story fights: paying only on victory let a single
   * loss strand the player a level below every later encounter, and that gap
   * compounds - a lost fight is followed by more fights the player is now
   * weaker against, which is a death spiral with no recovery. The campaign is
   * authored so either branch reaches the same next beat, so the milestone pays
   * either way; the win/lose difference is which road you take and the HP you
   * arrive with, never the level you arrive at.
   */
  const expEffects = [{ op: 'exp' as const, amount: node.enemy.exp }]
  const { run: afterExp, levelsGained: expLevels } = applyEffects(afterEffects, expEffects, ctx.catalog)

  const next: RunState = {
    ...afterExp,
    transcript: [
      ...afterExp.transcript,
      outcome.won ? `${node.enemy.name} is put down.` : `You fall to ${node.enemy.name}.`,
    ],
  }

  return {
    run: next,
    nextNodeId: target.next,
    expGained: outcome.won ? node.enemy.exp : 0,
    levelUps: [...levelsGained, ...expLevels],
    itemsGained,
  }
}

/* ── Node position ────────────────────────────────────────────────────── */

export function currentNode(run: RunState, ctx: RunContext): ContentNode {
  return nodeOf(ctx.content, run.currentNodeId)
}

export function isCombatNode(run: RunState, ctx: RunContext): boolean {
  return isCombat(currentNode(run, ctx))
}

export function isEndingNode(run: RunState, ctx: RunContext): boolean {
  return isEnding(currentNode(run, ctx))
}
