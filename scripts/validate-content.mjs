/**
 * Content validator.
 *
 * Shape correctness is handled by the shared zod schemas. This script checks
 * meaning: references that resolve, nodes a player can actually reach, endings
 * that carry their payout fields, and effect/requirement targets that exist.
 *
 * Unwritten prose is reported as a warning by default and as an error under
 * `--strict`. That split matters right now: the content author is filling the
 * narrative in, and CI should not pretend the prose is finished while also never
 * letting a placeholder reach a submission.
 *
 * Usage: node scripts/validate-content.mjs [--strict]
 */

import { loadAll, Report, strictFlag } from './lib/content.mjs'

const TRAITS = ['courage', 'reputation', 'royal_loyalty']
const PROSE_MARKER = 'TODO'

/*
 * Layout budgets, not a house style.
 *
 * The frame is a fixed box that the browser is forbidden from scrolling, and the
 * prose pane is the only part of it allowed its own scrollbar. These two numbers
 * are what the current copy actually fits: a 958x638 desktop frame shows every
 * node as written, and a 358x638 phone shows all but the longest, where the
 * player scrolls the story to read a decision they are meant to be making.
 *
 * Prose over the budget still runs. It is an error anyway, because the failure is
 * invisible in review: the text is not cut off in the DOM, it just stops being
 * on screen on the one device that is already the tightest fit.
 *
 * Measured against the label column at 0.94rem monospace, which is about 282px
 * wide on the phone frame: 28 characters holds one line, and 29 wraps.
 */
const PROSE_BUDGET = 340
const LABEL_BUDGET = 28

function main() {
  const report = new Report('Kaldareth — content validation')
  let loaded
  try {
    loaded = loadAll()
  } catch (error) {
    if (error.shapeErrors) {
      process.stdout.write('\nKaldareth — content validation\n=================================\n')
      for (const e of error.shapeErrors) process.stdout.write(`  x ${e}\n`)
      process.stdout.write('\nFAILED (shape validation)\n')
      process.exit(1)
    }
    throw error
  }

  const { content, data, balance } = loaded
  const nodes = content.nodes
  const itemIds = new Set(Object.keys(data.items))
  const traitIds = new Set(TRAITS)

  const nodeIds = new Set(Object.keys(nodes))
  const references = [] // { from, to, kind }

  report.section(`Story: ${content.meta.title}`)
  report.note(`  version   ${content.version}`)
  report.note(`  start     ${content.meta.start}`)
  report.note(`  nodes     ${nodeIds.size}`)

  /* ── Start node ───────────────────────────────────────────────────── */

  if (!nodeIds.has(content.meta.start)) {
    report.error(`meta.start "${content.meta.start}" is not a node`)
  } else if (nodes[content.meta.start].type === 'ending') {
    report.error(`meta.start "${content.meta.start}" is an ending node; a run must start on narrative or combat`)
  }

  /* ── Per-node checks ──────────────────────────────────────────────── */

  const endings = []
  let longestProse = { id: '', length: 0 }
  let longestLabel = { where: '', length: 0 }

  for (const [id, node] of Object.entries(nodes)) {
    if (node.id !== id) {
      report.error(`node key "${id}" disagrees with its own id "${node.id}"`)
    }

    if (node.text.length === 0) {
      report.error(`${id}: has no text paragraphs`)
    }
    node.text.forEach((paragraph, i) => {
      if (paragraph.includes(PROSE_MARKER)) {
        report.warn(`${id}: paragraph ${i + 1} still contains ${PROSE_MARKER} (unwritten prose)`)
      }
    })

    const proseLength = node.text.join(' ').length
    if (proseLength > longestProse.length) longestProse = { id, length: proseLength }
    if (proseLength > PROSE_BUDGET) {
      report.error(
        `${id}: prose is ${proseLength} characters, over the ${PROSE_BUDGET} budget (${proseLength - PROSE_BUDGET} too many); it will scroll on the phone frame`,
      )
    }

    if (node.type === 'narrative') {
      const choices = node.choices ?? []
      if (choices.length === 0) {
        report.error(`${id}: narrative node has no choices and is not a rest node (dead end)`)
      }
      const seenChoiceIds = new Set()
      for (const choice of choices) {
        if (seenChoiceIds.has(choice.id)) {
          report.error(`${id}: duplicate choice id "${choice.id}"`)
        }
        seenChoiceIds.add(choice.id)

        if (choice.verbs.length === 0) {
          report.error(`${id}/${choice.id}: no verbs; the choice can only be reached by number`)
        }
        const seenVerbs = new Set()
        for (const verb of choice.verbs) {
          const key = verb.toLowerCase()
          if (seenVerbs.has(key)) {
            report.error(`${id}/${choice.id}: duplicate verb "${verb}"`)
          }
          seenVerbs.add(key)
        }

        references.push({ from: id, to: choice.next, kind: `choice ${choice.id}` })

        if (choice.label.length > longestLabel.length) {
          longestLabel = { where: `${id}/${choice.id}`, length: choice.label.length }
        }
        if (choice.label.length > LABEL_BUDGET) {
          report.error(
            `${id}/${choice.id}: label is ${choice.label.length} characters, over the ${LABEL_BUDGET} budget (${choice.label.length - LABEL_BUDGET} too many); it wraps to a second line, and on a three-choice gate node that crowds the prose pane off the phone frame`,
          )
        }

        for (const req of choice.requires ?? []) {
          if (req.kind === 'trait' && !traitIds.has(req.trait)) {
            report.error(`${id}/${choice.id}: unknown trait "${req.trait}"`)
          }
          if (req.kind === 'item' && !itemIds.has(req.itemId)) {
            report.error(`${id}/${choice.id}: requires unknown item "${req.itemId}"`)
          }
        }
        for (const effect of choice.effects ?? []) {
          checkEffect(report, `${id}/${choice.id}`, effect, { traitIds, itemIds })
        }
      }
    }

    if (node.type === 'combat') {
      references.push({ from: id, to: node.onWin.next, kind: 'onWin' })
      references.push({ from: id, to: node.onLose.next, kind: 'onLose' })
      if (node.onWin.next === node.onLose.next) {
        report.warn(`${id}: onWin and onLose both lead to "${node.onWin.next}"; the fight has no lasting consequence`)
      }
      if (node.enemy.exp <= 0) {
        report.error(`${id}: enemy grants ${node.enemy.exp} EXP; every combat must reward progress`)
      }
      if (node.enemy.stats.hp <= 0) {
        report.error(`${id}: enemy has non-positive HP`)
      }
      if (node.enemy.dropItemId && !itemIds.has(node.enemy.dropItemId)) {
        report.error(`${id}: enemy drop references unknown item "${node.enemy.dropItemId}"`)
      }
    }

    if (node.type === 'ending') {
      endings.push(id)
      if (typeof node.reward_modifier !== 'number') {
        report.error(`${id}: ending is missing reward_modifier`)
      }
      if (!node.leaderboard_tag) {
        report.error(`${id}: ending is missing leaderboard_tag`)
      }
      if (node.reward_modifier < 1) {
        report.warn(`${id}: reward_modifier is below 1, so finishing pays less than an unfinished run`)
      }
    }

    for (const effect of node.onEnter ?? []) {
      checkEffect(report, `${id}/onEnter`, effect, { traitIds, itemIds })
    }
  }

  if (endings.length === 0) {
    report.error('no ending nodes: a run can never resolve')
  }

  /* ── Layout budget ────────────────────────────────────────────────── */

  report.section('Layout budget')
  report.note(`  longest prose       ${longestProse.length} chars (${longestProse.id}) of ${PROSE_BUDGET}`)
  report.note(`  longest label       ${longestLabel.length} chars (${longestLabel.where}) of ${LABEL_BUDGET}`)

  /* ── Prose style ──────────────────────────────────────────────────── */

  /*
   * Prose is written one node at a time, so nothing stops a signature
   * construction from accreting across nodes until the whole campaign reads
   * like one sentence recycled. This pass reads all of it at once and warns on
   * the two failure modes that actually happened here:
   *
   *  - A tic density over budget. "..., the way X does Y" sat in 23% of nodes
   *    (a player meets it every 4-5 nodes); the pass found it because a human
   *    reader wouldn't. The 10% budget allows the construction where it earns
   *    its place without letting it become furniture.
   *  - An echo: the same run of four or more words in two different nodes.
   *    With two sentences per node any exact 4-gram appearing twice is almost
   *    certainly a copy-paste remnant rather than intent.
   */
  const TIC = / the way /gi
  const TIC_BUDGET = 0.1
  const ECHO_LENGTH = 6
  let ticCount = 0
  const ticNodes = new Set()
  const gramIndex = new Map()
  const warnedEchoes = new Set()

  /* Proper names (enemies, items) recur by design and are not prose echoes. */
  const protectedPhrases = []
  for (const node of Object.values(nodes)) {
    if (node.type === 'combat') protectedPhrases.push(node.enemy.name.toLowerCase())
  }
  for (const item of Object.values(data.items)) protectedPhrases.push(item.name.toLowerCase())

  for (const [id, node] of Object.entries(nodes)) {
    for (const paragraph of node.text) {
      const lower = paragraph.toLowerCase()
      const hits = lower.match(TIC)?.length ?? 0
      if (hits > 0) {
        ticCount += hits
        ticNodes.add(id)
      }
      if (protectedPhrases.some((p) => lower.includes(p))) continue
      const words = lower.replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean)
      const chapter = id.match(/^ch(\d+)/)?.[1] ?? '?'
      for (let i = 0; i + ECHO_LENGTH <= words.length; i += 1) {
        const gram = words.slice(i, i + ECHO_LENGTH).join(' ')
        const seen = gramIndex.get(gram)
        /* Motifs inside one chapter (the per-class epilogues, say) are design;
           the same sentence drifting between chapters thirty nodes apart is not. */
        if (seen && seen.id !== id && seen.chapter !== chapter && !warnedEchoes.has(gram)) {
          warnedEchoes.add(gram)
          report.warn(`${id}: 6-word echo of "${seen.id}" - "${gram}" appears verbatim in both nodes`)
        } else gramIndex.set(gram, { id, chapter })
      }
    }
  }

  report.section('Prose style')
  const ticPct = nodeIds.size === 0 ? 0 : ticCount / nodeIds.size
  report.note(`  "the way" tic       ${ticCount} use(s) across ${ticNodes.size}/${nodeIds.size} nodes - budget ${(TIC_BUDGET * 100).toFixed(0)}% of nodes`)
  if (ticPct > TIC_BUDGET) {
    const offenders = [...ticNodes].slice(0, 8).join(', ')
    report.warn(
      `the "the way X" construction appears ${ticCount} times across ${nodeIds.size} nodes (${(ticPct * 100).toFixed(0)}%), over the 10% style budget - rewrite the weakest instances first: ${offenders}...`,
    )
  }

  /* ── References ───────────────────────────────────────────────────── */

  report.section('References')
  for (const ref of references) {
    if (!nodeIds.has(ref.to)) {
      report.error(`${ref.from}: ${ref.kind} points at unknown node "${ref.to}"`)
    }
  }

  // Stage monotonicity: a run may branch sideways, but never walk backwards.
  for (const ref of references) {
    const from = nodes[ref.from]
    const to = nodes[ref.to]
    if (!from || !to) continue
    if (to.stage < from.stage) {
      report.error(
        `${ref.from} (stage ${from.stage}) → ${ref.to} (stage ${to.stage}) via ${ref.kind}: stage goes backwards`,
      )
    }
  }

  /* ── Reachability ─────────────────────────────────────────────────── */

  report.section('Reachability')
  const reachable = new Set()
  const queue = nodeIds.has(content.meta.start) ? [content.meta.start] : []
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || reachable.has(current)) continue
    reachable.add(current)
    for (const ref of references) {
      if (ref.from === current && !reachable.has(ref.to)) queue.push(ref.to)
    }
  }

  const orphans = [...nodeIds].filter((id) => !reachable.has(id))
  for (const id of orphans) {
    report.error(`${id}: unreachable from meta.start`)
  }
  if (orphans.length === 0) {
    report.note(`  all ${nodeIds.size} nodes reachable`)
  }

  /* ── Class gates ──────────────────────────────────────────────────── */

  report.section('Class coverage')
  const declared = content.meta.classes ?? []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'narrative') continue
    const classReqs = (node.choices ?? []).flatMap((c) => c.requires ?? []).filter((r) => r.kind === 'class')
    if (classReqs.length === 0) continue
    const covered = new Set(classReqs.map((r) => r.classId))
    for (const classId of declared) {
      if (!covered.has(classId)) {
        report.error(`${node.id}: class gate does not offer a "${classId}" route`)
      }
    }
    if (classReqs.length > 1) {
      report.note(`  ${node.id}: ${classReqs.length}-way class gate`)
    }
  }

  /* ── Economy cross-checks ─────────────────────────────────────────── */

  report.section('Economy')
  const { entryFee, split, dailyQuotaByGeneration, startingBalance } = balance.economy
  const splitTotal = split.prizePool + split.circulation + split.burn
  if (splitTotal !== entryFee) {
    report.error(`split sums to ${splitTotal} but entryFee is ${entryFee}`)
  } else {
    report.note(`  fee ${entryFee} -> pool ${split.prizePool} / circulation ${split.circulation} / burn ${split.burn}`)
  }
  if (startingBalance < entryFee) {
    report.error(`starting balance ${startingBalance} cannot cover the ${entryFee} entry fee`)
  }
  for (const gen of ['1', '2', '3', '4', '5', '6']) {
    if (!dailyQuotaByGeneration[gen]) {
      report.error(`dailyQuotaByGeneration is missing generation ${gen}`)
    }
  }
  if (dailyQuotaByGeneration['0']) {
    report.error('generation 0 must have no quota: it is ineligible and must never open a run')
  }
  for (const [gen, quota] of Object.entries(dailyQuotaByGeneration)) {
    if (!Number.isInteger(Number(gen))) {
      report.error(`dailyQuotaByGeneration key "${gen}" is not a generation number`)
    }
    if (quota < 1) {
      report.error(`generation ${gen} quota must be at least 1 run`)
    }
  }

  /* ── Rarity reachability ──────────────────────────────────────────── */

  report.section('Loot')
  const rarities = new Set(Object.values(data.items).map((i) => i.rarity))
  report.note(`  catalogue: ${Object.keys(data.items).length} item(s), rarities: ${[...rarities].join(', ') || 'none'}`)
  for (const [id, item] of Object.entries(data.items)) {
    if (item.id !== id) report.error(`item key "${id}" disagrees with its own id "${item.id}"`)
  }
  const tierRarity = { miniboss: 'rare', boss: 'epic' }
  for (const node of Object.values(nodes)) {
    if (node.type !== 'combat') continue
    const expected = tierRarity[node.enemy.tier]
    if (node.enemy.dropItemId) {
      const item = data.items[node.enemy.dropItemId]
      const expectedIndex = ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(expected)
      const actualIndex = ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(item.rarity)
      if (actualIndex < expectedIndex) {
        report.error(
          `${node.id}: a ${node.enemy.tier} dropped "${item.name}" (${item.rarity}); the reward table says ${expected} or better`,
        )
      }
    } else {
      report.warn(`${node.id}: ${node.enemy.tier} "${node.enemy.name}" drops no item`)
    }
  }

  const failed = report.print({ strict: strictFlag })
  process.exit(failed ? 1 : 0)
}

function checkEffect(report, where, effect, { traitIds, itemIds }) {
  if ((effect.op === 'add' || effect.op === 'set') && !traitIds.has(effect.trait)) {
    report.error(`${where}: unknown trait "${effect.trait}"`)
  }
  if (effect.op === 'give' && !itemIds.has(effect.itemId)) {
    report.error(`${where}: grants unknown item "${effect.itemId}"`)
  }
  if (effect.op === 'exp' && effect.amount < 0) {
    report.error(`${where}: negative EXP award (${effect.amount})`)
  }
  if ((effect.op === 'add' || effect.op === 'set') && effect.amount === 0) {
    report.warn(`${where}: ${effect.op} with amount 0 does nothing`)
  }
}

main()
