/**
 * Application shell.
 *
 * Two phases, in order: pick a class, then pass the entry screen, then play.
 *
 * The ownership gate is not in this file, and there is no stub of one. It lives in
 * the trusted host document: the SDK runtime connects the wallet, discovers the
 * owned Friends, re-verifies the selected one at a fresh block, and only then
 * mounts this game inside a sandboxed iframe. This file is told which verified
 * Friend it is running for and never learns a wallet address, so it cannot check
 * ownership even if it wanted to — and it must not, because a check that the game
 * performs for itself is a check a player can skip.
 *
 * Paragraph reveal is one click at a time, because the pacing of a text game is
 * the pacing of the reveal, not the length of the text.
 */

import { useMemo, useState } from 'react'

import { BALANCE, STORY } from './content/content.ts'
import { unlockedSkills } from './engine/skills.ts'
import { matchVerb } from './engine/verbMatch.ts'
import { RUN_CONTEXT, runIsCombat, runIsEnding, useRun } from './game/useRun.ts'
import { choicesOf, currentNode } from './engine/run.ts'
import type { RunState } from './engine/run.ts'
import type { ClassId } from './engine/types.ts'
import type { QuotaDecision } from './economy/quota.ts'
import {
  ChoiceList,
  ClassSelect,
  CombatPanel,
  EndingPanel,
  InventoryPanel,
  StatusPanel,
} from './ui/components.tsx'

/** What the runtime tells the game about the session it mounted. */
export interface AppSession {
  /** Verified Friend id. The runtime guarantees generation ≥ 1 for this id. */
  friendId: bigint
  /** Display label for that Friend, matching the host's own label. */
  label: string
  /** `preview` for simulated actions; `chain` only with a live deployment. */
  mode: 'preview' | 'chain'
  quota: QuotaDecision
  /** True while a runtime menu is open. Game input must yield to it. */
  paused: boolean
  /** Charges one run against the session quota. False when none remain. */
  startRun: (classId: ClassId) => boolean
}

export default function App({ session }: { session: AppSession }) {
  const controller = useRun()
  const { phase, run, combat, notice } = controller
  const [refusal, setRefusal] = useState<string | null>(null)
  const paused = session.paused

  const begin = (classId: ClassId) => {
    if (!session.startRun(classId)) {
      setRefusal(session.quota.reason ?? 'No runs remain for this Friend today.')
      return
    }
    setRefusal(null)
    controller.begin(classId)
  }

  if (phase === 'class' || !run) {
    return (
      <main className="kald-shell">
        <h1 className="kald-title">{STORY.meta.title}</h1>
        {/*
         * One note rather than two. They were a paragraph about the run and a
         * line about the quota, and at 358px wide the pair cost six lines of a
         * 478px frame that the three class buttons then had to fit under.
         */}
        <p className="kald-note">
          Act 1 — Emberfall. Every run is a new character, decided by a seed you can share. Playing as{' '}
          {session.label} · {session.quota.remaining} of {session.quota.limit} runs left today.
        </p>
        <ClassSelect onBegin={begin} />
        {refusal ? (
          <p className="kald-error" role="alert">
            {refusal}
          </p>
        ) : null}
      </main>
    )
  }

  if (phase === 'gate') {
    return <Entry session={session} onEnter={controller.enterGate} />
  }

  // The runtime pauses the game while its own menus are open, and an overlay
  // inside a 480px frame is easier to miss than a blanked-out column, so the whole
  // stage is made inert rather than one control at a time.
  const stage = runIsEnding(run) ? (
    <main className="kald-shell">
      <EndingPanel run={run} onRestart={controller.abandon} />
    </main>
  ) : (
    <main className="kald-shell">
      <header className="kald-banner">
        <span className="kald-chapter">Act 1</span>
        <span className="kald-place">{run.currentNodeId.replace(/^ch\d+_/, '').replace(/_/g, ' ')}</span>
      </header>
      <hr className="kald-rule" />

      <div className="kald-columns">
        <article className="kald-scene">
          <Prose run={run} />
          {notice ? <p className="kald-note">{notice.text}</p> : null}
          {combat ? (
            <CombatPanel
              state={combat.state}
              skills={unlockedSkills(run.classId, run.progression.level)}
              onAct={controller.act}
            />
          ) : runIsCombat(run) ? null : (
            <CommandLine run={run} onSubmit={controller.choose} setNoticeOverride={controller.setNotice} />
          )}
        </article>

        <StatusPanel run={run} />
      </div>

      <hr className="kald-rule" />
      {/*
       * Inventory and Abandon share a row. Stacked, the pair cost 64px of a 478px
       * phone frame, and the player reads the inventory while deciding and
       * abandons only when leaving.
       */}
      <div className="kald-foot">
        <InventoryPanel run={run} />
        <button type="button" className="kald-btn kald-btn-ghost kald-abandon" onClick={controller.abandon}>
          Abandon run
        </button>
      </div>
    </main>
  )

  return (
    <>
      {paused ? (
        <p className="kald-paused" role="status">
          Paused — the runtime has a menu open.
        </p>
      ) : null}
      {/*
       * `kald-stage` carries the height, not just the shell.
       *
       * This wrapper is a plain block, so the shell's `height: 100%` resolved
       * against an auto-height parent and became `auto` — the column then grew to
       * its content and pushed the ending's standings list 137px out of a 638px
       * frame. The class/entry screens returned before this wrapper and were fine,
       * which is what made it look like a screen-specific problem.
       */}
      <div className="kald-stage" inert={paused || undefined}>
        {stage}
      </div>
    </>
  )
}

/* ── Prose reveal ──────────────────────────────────────────────────────── */

function Prose({ run }: { run: RunState }) {
  const node = currentNode(run, RUN_CONTEXT)
  const paragraphs = node.text
  // Tracked as the node it belongs to, so arriving somewhere resets the reveal
  // during render. Resetting in an effect would first render the *next* node's
  // paragraphs at the *previous* node's reveal depth — one frame of the wrong text
  // whenever the new node is longer than the reveal the reader had reached.
  const [shown, setShown] = useState({ nodeId: run.currentNodeId, count: 1 })

  if (shown.nodeId !== run.currentNodeId) {
    setShown({ nodeId: run.currentNodeId, count: 1 })
  }

  const revealed = shown.nodeId === run.currentNodeId ? shown.count : 1
  const setRevealed = (count: number) => setShown({ nodeId: run.currentNodeId, count })

  if (revealed < paragraphs.length) {
    return (
      <div className="kald-prose">
        {paragraphs.slice(0, revealed).map((paragraph, index) => (
          <p key={index} className="kald-paragraph">
            {paragraph}
          </p>
        ))}
        <button type="button" className="kald-btn kald-skip" onClick={() => setRevealed(paragraphs.length)}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="kald-prose">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="kald-paragraph">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

/* ── Command line ──────────────────────────────────────────────────────── */

function CommandLine({
  run,
  onSubmit,
  setNoticeOverride,
}: {
  run: RunState
  onSubmit: (choiceId: string) => void
  setNoticeOverride: (text: string | null) => void
}) {
  const [text, setText] = useState('')
  const choices = useMemo(() => choicesOf(run, RUN_CONTEXT), [run])

  const views = choices.map((entry) => ({
    choice: { id: entry.choice.id, label: entry.choice.label },
    enabled: entry.enabled,
    reason: entry.reason,
  }))

  const submit = () => {
    if (text.trim() === '') return
    const match = matchVerb(
      text,
      choices.map((entry, index) => ({
        index,
        label: entry.choice.label,
        verbs: entry.choice.verbs,
      })),
    )
    setText('')
    if (match.kind === 'choice') {
      const entry = choices[match.index]
      if (entry) onSubmit(entry.choice.id)
      return
    }
    if (match.kind === 'ambiguous') {
      // A near-tie is not resolved by guessing; the numbered list above is the
      // answer, and the first candidate is pre-focused by the caller.
      setNoticeOverride('That could mean more than one thing — pick a number.')
      return
    }
    // Silence here is the worst of the three outcomes: the player typed a full
    // sentence, pressed Enter, and got no reaction at all, with no way to tell a
    // game that ignored them from a game that is broken.
    setNoticeOverride('Nothing here answers to that — try a number, or one of the verbs listed above.')
  }

  return (
    <div className="kald-command">
      <ChoiceList choices={views} onChoose={onSubmit} />
      {/*
       * No <form> here, on purpose.
       *
       * The SDK mounts this game in an iframe sandboxed `allow-scripts` and
       * nothing else — no forms, no navigation, no same-origin. A sandbox without
       * `allow-forms` makes the browser refuse to submit any form, so a form-wrapped
       * command line looks perfect and silently does nothing: the click and the
       * Enter key both go nowhere, with no error to explain why. That is not a
       * hypothetical. It is exactly what this component did until the browser
       * suite typed into it.
       *
       * So the field handles Enter itself, and the button is an ordinary button.
       */}
      <div className="kald-command-row">
        {/*
         * Visually hidden, still the field's accessible name.
         *
         * The visible text this replaced was instruction — "Or act in your own
         * words" — which the placeholder already demonstrates and a `label`
         * element is the wrong home for anyway. On a phone it was a 26px row of
         * duplicated meaning between the choices and the box they point at. The
         * choices carry numbers and the field carries an example, so nothing the
         * player needs was in it.
         */}
        <label className="kald-label" htmlFor="cmd">
          Act in your own words
        </label>
        <div className="kald-command-field">
          <input
            id="cmd"
            className="kald-input"
            value={text}
            placeholder="burn the bridge"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              submit()
            }}
            autoComplete="off"
          />
          <button type="button" className="kald-btn" onClick={submit}>
            Act
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Entry ─────────────────────────────────────────────────────────────── */

/**
 * The terms of entry, shown after the runtime has already verified the Friend.
 *
 * This screen used to hold a stub ownership check and a "Continue without a
 * wallet" button. Both are gone: the real check happens in the host, and a
 * bypass here would have been a way to reach the game without an NFT. What
 * remains is a disclosure — who is playing, what a run costs, what the fee is
 * split into, and how many runs are left — because a game that charges a fee
 * should say so before the player walks in.
 */
function Entry({ session, onEnter }: { session: AppSession; onEnter: () => void }) {
  const { entryFee, currency, split, startingBalance } = BALANCE.economy
  const simulated = session.mode === 'preview'

  return (
    <main className="kald-shell">
      {/*
       * The fee split and the preview caveat are more words than a 358x478 frame
       * holds. Rather than let `#root` clip them — which would put "Enter
       * Kaldareth" off-screen and unreachable — the terms are the scrolling
       * region and the button stays pinned outside it. A gate the player cannot
       * press is a gate the player cannot pass.
       */}
      <div className="kald-prose">
        <h1 className="kald-title">Entry</h1>
        <p className="kald-note">
          {session.label} is your ticket. The runtime checked that this Friend is yours on Robinhood
          Chain, and again when this session opened. Kaldareth never asks you to sign anything.
        </p>
        <dl className="kald-table">
          <div>
            <dt>Playing as</dt>
            <dd>{session.label}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>Robinhood Chain (4663)</dd>
          </div>
          <div>
            <dt>Entry fee</dt>
            <dd>
              {entryFee} {currency} — {split.prizePool} to the weekly prize pool, {split.circulation}{' '}
              to circulation, {split.burn} burned
            </dd>
          </div>
          <div>
            <dt>Runs today</dt>
            <dd>
              {session.quota.remaining} of {session.quota.limit} left
            </dd>
          </div>
          <div>
            <dt>Purse at the start</dt>
            <dd>
              {startingBalance.toLocaleString('en-US')} {currency}
            </dd>
          </div>
        </dl>
        {simulated ? (
          <p className="kald-note">
            Preview build: balances, the fee split and the leaderboard are simulated in your browser.
            Nothing is charged or settled.
          </p>
        ) : null}
      </div>
      <div className="kald-actions">
        <button type="button" className="kald-btn" onClick={onEnter}>
          Enter Kaldareth
        </button>
      </div>
    </main>
  )
}
