/**
 * Presentational components.
 *
 * Almost all of them are pure functions of props, so the run hook stays the single
 * owner of game state and every screen can be rendered in isolation — which is
 * what the Playwright specs do.
 *
 * `StatusPanel` is the exception. It holds one boolean, for a disclosure, and
 * holds it locally because the open state is a view preference rather than
 * anything the engine or the run hook needs to know about.
 *
 * Hidden stats are never shown as numbers. The player sees the band label the
 * GDD defines ("steadfast", "wavering"), because the number is bookkeeping and
 * the label is the fiction.
 */

import { TRAIT_IDS } from '../engine/types.ts'
import type {
  ClassId,
  Combatant,
  CombatLine,
  CombatState,
  ItemDefinition,
  SkillDefinition,
  TraitId,
} from '../engine/types.ts'
import { useMemo, useState } from 'react'

import { BALANCE } from '../content/content.ts'
import { buildGhostBoard } from '../economy/ghostBoard.ts'
import { placement, rank, scoreGhost, scoreRun } from '../economy/leaderboard.ts'
import { levelProgress } from '../engine/progression.ts'
import { describeItem } from '../engine/items.ts'
import { traitLabel } from '../game/useRun.ts'
import type { RunState } from '../engine/run.ts'

/* ── Status ────────────────────────────────────────────────────────────── */

export function StatusPanel({ run }: { run: RunState }) {
  const progress = levelProgress(run.progression)
  const maxHp = run.stats.hp
  const [open, setOpen] = useState(false)
  return (
    <aside className="kald-status" aria-label="Run status">
      {/*
       * A status panel that is always open is 387px of a 638px frame — measured,
       * 60% of the screen spent on four numbers and three adjectives. The strip
       * below carries the two things a player checks mid-scene, health and level,
       * and everything else waits behind a disclosure.
       *
       * It is a button rather than a checkbox so it is reachable by keyboard and
       * announced as the control it is, and `aria-expanded` carries the state
       * because there is no persistent element for a native `details` summary to
       * name here.
       */}
      <div className="kald-status-bar">
        <span className="kald-status-key">
          L{run.progression.level} {run.classId}
        </span>
        <span className="kald-status-key">
          HP {Math.max(0, Math.round(run.currentHp))}/{maxHp}
        </span>
        <span className="kald-status-key">{run.tokens.toLocaleString('en-US')} TOKEN</span>
        <button
          type="button"
          className="kald-disclosure"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide status' : 'Status'}
        </button>
      </div>

      {open ? (
        <div className="kald-status-body">
          <div className="kald-label">Level {run.progression.level}</div>
          <div
            className="kald-meter"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>

          <div className="kald-label">Health</div>
          <div className="kald-hp">
            {Math.max(0, Math.round(run.currentHp))} / {maxHp}
          </div>

          <div className="kald-label">Hidden</div>
          <dl className="kald-traits">
            {TRAIT_IDS.map((trait: TraitId) => (
              <div key={trait} className="kald-trait">
                <dt>{TRAIT_WORDS[trait]}</dt>
                <dd>{traitLabel(trait, run.traits[trait])}</dd>
              </div>
            ))}
          </dl>

          <div className="kald-label">Class</div>
          <div className="kald-value">{run.classId}</div>

          <div className="kald-label">Run</div>
          <div className="kald-value kald-code">{run.runCode}</div>
        </div>
      ) : null}
    </aside>
  )
}


const TRAIT_WORDS: Record<TraitId, string> = {
  courage: 'Courage',
  reputation: 'Reputation',
  royal_loyalty: 'Loyalty',
}

/* ── Inventory ─────────────────────────────────────────────────────────── */

export function InventoryPanel({ run }: { run: RunState }) {
  if (run.inventory.items.length === 0) {
    return <p className="kald-note">You carry nothing worth naming.</p>
  }
  return (
    <ul className="kald-table" aria-label="Inventory">
      {run.inventory.items.map((item: ItemDefinition) => {
        const rarity = `kald-rarity-${item.rarity}`
        const equipped = run.inventory.equippedId === item.id
        return (
          <li key={item.id} className={rarity}>
            {describeItem(item)}
            {equipped ? ' (worn)' : ''}
          </li>
        )
      })}
    </ul>
  )
}

/* ── Choices ───────────────────────────────────────────────────────────── */

export interface ChoiceView {
  choice: { id: string; label: string }
  enabled: boolean
  reason: string | null
}

export function ChoiceList({
  choices,
  onChoose,
}: {
  choices: ChoiceView[]
  onChoose: (choiceId: string) => void
}) {
  if (choices.length === 0) return null
  return (
    <ul className="kald-choices">
      {choices.map((entry, index) => (
        <li key={entry.choice.id}>
          <button
            type="button"
            className="kald-choice"
            disabled={!entry.enabled}
            onClick={() => onChoose(entry.choice.id)}
            title={entry.reason ?? undefined}
          >
            <span className="kald-choice-num">{index + 1}</span>
            {/*
             * The lock reason flows inside the label rather than sitting beside it
             * or under it. As a third flex sibling it squeezed the label into a
             * narrow column and made a locked option 83px tall on a phone; as its
             * own row it added 19px on top of a two-line label. Inline, a locked
             * option reads as one sentence and costs one line.
             *
             * It stays a real element rather than a `title` alone, so it is
             * announced and it is visible without a pointer.
             */}
            <span className="kald-choice-label">
              {entry.choice.label}
              {!entry.enabled && entry.reason ? (
                <span className="kald-choice-lock"> — {entry.reason}</span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/* ── Combat ────────────────────────────────────────────────────────────── */

/**
 * The log is a discriminated union, so each line gets an explicit sentence.
 * A fallback case is kept on purpose: a line kind added to the engine without
 * being rendered here should show its text, not crash the fight.
 */
function describeLine(line: CombatLine): string {
  switch (line.kind) {
    case 'attack':
      return `${line.actor} hits ${line.target} for ${line.damage}${line.crit ? ' — a critical strike.' : '.'}`
    case 'miss':
      return `${line.actor} misses ${line.target}. ${line.reason}`
    case 'skill':
      return line.text
    case 'status':
      return line.text
    case 'dot':
      return `${line.label} burns ${line.actor} for ${line.damage}.`
    case 'heal':
      return `${line.actor} recovers ${line.amount}.`
    case 'end':
      return line.text
    default:
      return ''
  }
}

function critClass(line: CombatLine): string {
  if (line.kind === 'attack' && line.crit) return 'kald-combat-line kald-crit'
  if (line.kind === 'dot') return 'kald-combat-line kald-crit'
  return 'kald-combat-line'
}

function HealthBar({ combatant, name }: { combatant: Combatant; name: string }) {
  const pct = combatant.hpMax > 0 ? Math.max(0, combatant.hp / combatant.hpMax) : 0
  return (
    <div className="kald-hp">
      {name} {Math.max(0, combatant.hp)}/{combatant.hpMax}
      <span className="kald-meter" aria-hidden="true">
        <span style={{ width: `${Math.round(pct * 100)}%` }} />
      </span>
    </div>
  )
}

export function CombatPanel({
  state,
  skills,
  onAct,
}: {
  state: CombatState
  skills: SkillDefinition[]
  onAct: (skillId: string) => void
}) {
  return (
    <section className="kald-combat" aria-label="Combat">
      <HealthBar combatant={state.player} name="You" />
      <HealthBar combatant={state.enemy} name={state.enemy.name} />

      <ol className="kald-combat-log">
        {state.log.slice(-8).map((line, index) => (
          <li key={`${state.turn}-${index}`} className={critClass(line)}>
            {describeLine(line)}
          </li>
        ))}
      </ol>

      {!state.over ? (
        <ul className="kald-choices">
          {state.available.map((id) => {
            const skill = skills.find((s) => s.id === id)
            if (!skill) return null
            return (
              <li key={id}>
                <button type="button" className="kald-choice" onClick={() => onAct(id)}>
                  {skill.name}
                  {skill.resourceCost > 0 ? <span className="kald-cost"> ({skill.resourceCost})</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="kald-note">{state.won ? 'The encounter is over.' : 'You cannot continue.'}</p>
      )}
    </section>
  )
}

/* ── Class select ──────────────────────────────────────────────────────── */

const CLASS_SUMMARIES: Record<ClassId, { name: string; line: string }> = {
  warrior: { name: 'Warrior', line: 'Heaviest health, hardest to move. Builds rage by being hit.' },
  archer: { name: 'Archer', line: 'Highest agility and crit. Marks targets, then punishes the wound.' },
  mage: { name: 'Mage', line: 'Highest focus. Wields aether, wards itself, and bends time.' },
}

export function ClassSelect({ onBegin }: { onBegin: (classId: ClassId) => void }) {
  return (
    <div className="kald-choices kald-classes">
      {(Object.keys(CLASS_SUMMARIES) as ClassId[]).map((classId) => (
        <div key={classId} className="kald-class">
          {/*
           * `aria-describedby` rather than the summary inside the button: the
           * accessible name stays "Warrior" instead of becoming a sentence, and
           * the description is still announced. The ids are derived from a closed
           * set of class ids, so they are stable and unique.
           */}
          <button
            type="button"
            className="kald-btn"
            aria-describedby={`kald-class-${classId}`}
            onClick={() => onBegin(classId)}
          >
            {CLASS_SUMMARIES[classId].name}
          </button>
          <p className="kald-note" id={`kald-class-${classId}`}>
            {CLASS_SUMMARIES[classId].line}
          </p>
        </div>
      ))}
    </div>
  )
}

/* ── Leaderboard ───────────────────────────────────────────────────────── */

/**
 * The board mixes one real run with simulated rivals.
 *
 * The `simulated` flag is rendered on every ghost row, not just carried in the
 * data. A player who mistook a deterministic ghost for a real rival would be
 * reading the board wrong in a way that is never visible from a screenshot.
 */
export function LeaderboardPanel({ run }: { run: RunState }) {
  const ghosts = useMemo(
    () => buildGhostBoard(BALANCE.economy.ghostBoard.seed, BALANCE.economy.ghostBoard.size),
    [],
  )
  const board = useMemo(() => {
    const scores = [...ghosts.map(scoreGhost), scoreRun(run)]
    return { ranked: rank(scores), where: placement(scores, run.runCode) }
  }, [ghosts, run])

  return (
    <section className="kald-panel" aria-label="Leaderboard">
      <p className="kald-chapter">
        You finished {ordinal(board.where.rank)} of {board.where.of}
      </p>
      <ol className="kald-table" aria-label="Standings">
        {board.ranked.map((entry) => (
          <li
            key={entry.runCode}
            className={entry.runCode === run.runCode ? 'kald-ghost' : undefined}
          >
            <span className="kald-rank">{entry.rank}</span>
            <span>{entry.name}</span>
            <span> {entry.classId} </span>
            <span>stage {entry.stage}</span>
            <span> hidden {entry.hiddenTotal}</span>
            <span> {entry.tokens.toLocaleString('en-US')} </span>
            {entry.simulated ? <span className="kald-label">simulated</span> : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

export function EndingPanel({
  run,
  onRestart,
}: {
  run: RunState
  onRestart: () => void
}) {
  return (
    <>
      {/*
       * The standings list is the longest thing in the game and the only part of
       * the ending whose length is not known ahead of time, so it is the region
       * that scrolls. The summary above it and the button below it stay put: a
       * "Begin a new run" button at the end of a scrollable list is a button that
       * a player has to go looking for.
       */}
      <div className="kald-prose">
        <section className="kald-panel" aria-label="Ending">
          <p className="kald-chapter">Run complete — {run.runCode}</p>
          <dl className="kald-table">
            <div>
              <dt>Level</dt>
              <dd>{run.progression.level}</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{run.stage}</dd>
            </div>
            <div>
              <dt>Nodes</dt>
              <dd>{run.visited.length}</dd>
            </div>
            <div>
              <dt>Wins</dt>
              <dd>{run.combatsWon}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{run.tokens.toLocaleString('en-US')}</dd>
            </div>
            <div>
              <dt>Modifier</dt>
              <dd>{run.rewardModifier ?? 1}×</dd>
            </div>
          </dl>
        </section>
        <LeaderboardPanel run={run} />
      </div>
      <div className="kald-actions">
        <button type="button" className="kald-btn" onClick={onRestart}>
          Begin a new run
        </button>
      </div>
    </>
  )
}
