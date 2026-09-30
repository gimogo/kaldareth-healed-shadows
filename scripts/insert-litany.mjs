/**
 * One-shot content patcher: inserts the 26 Litany Echo nodes — eight memory
 * checks, their pass/miss verdicts, and the secret ninth-echo gate — and
 * rewires the anchors. Run once: `node scripts/insert-litany.mjs`.
 *
 * A check asks what the story said, in its own words; the true answer pays a
 * flag, the two plausible echoes and open surrender lead to the miss side.
 * Both sides converge on the same next node, so the story always continues —
 * but only remembered chapters pay their ladder in full, and only a run that
 * kept ALL eight echoes can open the hidden ninth verdict at the epilogue.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const path = 'content/kaldareth.act1.json'
const content = JSON.parse(readFileSync(path, 'utf8'))

const CHECKS = [
  {
    chapter: 4,
    anchor: 'ch4_open',
    id: 'litany_1',
    prompt: 'The Hollowing leans close, checking. \u201cWhat did the Litany say of the Shepherd\u2019s arrival?\u201d',
    answers: [
      'When the fields are ready for harvest',
      'When the moon stands still over the fields',
      'When the last bell of Emberfall rings',
    ],
    pass: [
      '\u201cWhen the fields are ready for harvest.\u201d The words hold. The Hollowing recedes like a tide that found a wall it respects.',
      'Somewhere behind your ribs, something that was taken is handed back. You are still you. Hold on to that.',
    ],
    next: 'ch4_council',
  },
  {
    chapter: 8,
    anchor: 'ch8_open',
    id: 'litany_2',
    prompt: 'The pause comes again, and with it the question. \u201cWho fell with the bridge at Emberfall?\u201d',
    answers: [
      'Your family \u2014 the reason you walk at all',
      'A stranger you never learned to mourn',
      'No one. Emberfall burned empty',
    ],
    pass: [
      '\u201cMy family.\u201d The word has weight again. The Hollowing cannot eat what you refuse to hand over.',
      'The road ahead is the same road. It feels lighter to carry.',
    ],
    next: 'ch8_road',
  },
  {
    chapter: 12,
    anchor: 'ch12_open',
    id: 'litany_3',
    prompt: 'The road pauses between Kaelen\u2019s words. \u201cWhat did Senna keep, and never show anyone?\u201d',
    answers: [
      'A drawing of the harbor, made before the Hollowing',
      'A key to the council hall',
      'The Litany written in her own hand',
    ],
    pass: [
      '\u201cA drawing of the harbor.\u201d Senna\u2019s harbor. The Hollowing hisses \u2014 it wanted that one.',
      'Kaelen watches you a long moment. \u201cYou listen,\u201d he says, like it costs him something to approve.',
    ],
    next: 'ch12_cave',
  },
  {
    chapter: 16,
    anchor: 'ch16_open',
    id: 'litany_4',
    prompt: 'Before Greyhold\u2019s wall, the pause. \u201cWhat did Bryn ask of you before the Enforcer came?\u201d',
    answers: [
      'That you finish it \u2014 no matter what it costs him',
      'That you carry him home, whatever is left',
      'That you tell Kaelen he never doubted',
    ],
    pass: [
      '\u201cFinish it, no matter what it costs him.\u201d Bryn\u2019s vow, kept in your keeping.',
      'The road to Greyhold straightens. So does something in your chest.',
    ],
    next: 'ch16_enforcer',
  },
  {
    chapter: 20,
    anchor: 'ch20_open',
    id: 'litany_5',
    prompt: 'High on the pass, the Hollowing checks. \u201cWhat did Kaelen feel for the first time in three centuries?\u201d',
    answers: ['Hope', 'Fear', 'Hunger'],
    pass: [
      '\u201cHope.\u201d Three hundred years of duty, and hope came back the week you walked beside him.',
      'Kaelen does not thank you. He stands straighter. It is the same thing.',
    ],
    next: 'ch20_bryn',
  },
  {
    chapter: 24,
    anchor: 'ch24_open',
    id: 'litany_6',
    prompt: 'At Ashenmere\u2019s drowned gate, the question. \u201cWhat does the Hollowing eat?\u201d',
    answers: [
      'Memory \u2014 the world forgetting itself',
      'Flesh, and only flesh',
      'Light, and only light',
    ],
    pass: [
      '\u201cMemory.\u201d The Hollowing eats the world\u2019s remembering. That is why your pay thins when you fail to recall.',
      'Understanding is not victory. It is at least a map.',
    ],
    next: 'ch24_throne',
  },
  {
    chapter: 28,
    anchor: 'ch28_open',
    id: 'litany_7',
    prompt: 'The core hums; the pause comes with it. \u201cWhat anchors Veyra\u2019s blood ritual?\u201d',
    answers: [
      'Her own blood, given willingly',
      'The Litany carved in stone',
      'A relic of the Sundering',
    ],
    pass: [
      '\u201cHer own blood.\u201d Veyra never asked the world to pay for her. That is the whole of her, and you know it.',
      'The ritual\u2019s shape steadies in your mind.',
    ],
    next: 'ch28_anchor',
  },
  {
    chapter: 30,
    anchor: 'ch30_open',
    id: 'litany_8',
    prompt: 'The last pause, before the last road. \u201cWhy does Ilsevet refuse the light?\u201d',
    answers: [
      'To undo her own undoing, she must not be seen to change',
      'Because light burns her kind',
      'She has forgotten why \u2014 the Hollowing ate her reason',
    ],
    pass: [
      '\u201cShe must not be seen to change.\u201d Pride, the oldest engine. You understand her now, and understanding is the last weapon.',
      'The final road opens.',
    ],
    next: 'ch30_refusal',
  },
]

function missProse() {
  return [
    'The answer slips. It was said plainly, once, and the Hollowing was listening even when you were not.',
    'It takes its tithe from what you carried \u2014 not cruelly, just exactly. The road goes on, and the purse is lighter for it.',
  ]
}

let inserted = 0

for (const check of CHECKS) {
  const checkId = check.id
  const passId = `${checkId}_pass`
  const missId = `${checkId}_miss`
  const trueKey = `litany_true_${check.chapter}`

  content.nodes[checkId] = {
    id: checkId,
    stage: check.chapter,
    type: 'narrative',
    notes: 'Litany Echo memory check. Generated by scripts/insert-litany.mjs.',
    text: ['The road pauses. Somewhere in the fog, something is checking what you carry.', check.prompt],
    choices: [
      { id: 'true', label: `\u201c${check.answers[0]}\u201d`, verbs: ['true'], next: passId, effects: [{ op: 'flag', key: trueKey }] },
      { id: 'echo', label: `\u201c${check.answers[1]}\u201d \u2014 an echo that sounds almost right`, verbs: ['echo'], next: missId },
      { id: 'void', label: `\u201c${check.answers[2]}\u201d \u2014 the void\u2019s own tongue`, verbs: ['void'], next: missId },
      { id: 'admit', label: 'Admit you were not listening', verbs: ['admit'], next: missId },
    ],
  }
  inserted += 1

  content.nodes[passId] = {
    id: passId,
    stage: check.chapter,
    type: 'narrative',
    notes: 'Litany Echo verdict: remembered. Generated by scripts/insert-litany.mjs.',
    text: check.pass,
    choices: [{ id: 'continue', label: 'Walk on', verbs: ['continue', 'walk'], next: check.next }],
  }
  inserted += 1

  content.nodes[missId] = {
    id: missId,
    stage: check.chapter,
    type: 'narrative',
    notes: 'Litany Echo verdict: forgotten. Records the miss for the ladder multiplier. Generated by scripts/insert-litany.mjs.',
    text: missProse(),
    onEnter: [{ op: 'flag', key: `litany_miss_${CHECKS.indexOf(check) + 1}` }],
    choices: [{ id: 'continue', label: 'Walk on', verbs: ['continue', 'walk'], next: check.next }],
  }
  inserted += 1

  // Rewire the anchor: every existing choice now passes through the check.
  const anchor = content.nodes[check.anchor]
  for (const choice of anchor.choices) {
    choice.next = checkId
  }
}

// ── The secret ninth verdict ────────────────────────────────────────────
// The healed ending keeps two paragraphs of humility before the peace; a run
// that kept all eight echoes earns a third door: what the Litany really is.

content.nodes['litany_ninth'] = {
  id: 'litany_ninth',
  stage: 32,
  type: 'narrative',
  notes: 'Secret epilogue: opens only with all eight echoes kept. Generated by scripts/insert-litany.mjs.',
  text: [
    'The fog thins one last time, and the Hollowing \u2014 the whole of it, the appetite itself \u2014 stands before you unarmored.',
    '\u201cEight times,\u201d it says, \u201cyou held the road\u2019s words against my hunger. Do you know what you are carrying, keeper?\u201d',
    'The Litany was never a prayer for the fields. It is a leash \u2014 the survivors of the first Sundering, binding the thing that ate their world, singing the leash-words into every child until no one remembered they were chains.',
    'The Hollowing does not want to be fed. It wants to be *put down* \u2014 and it cannot be, while Kaldareth sings its leash as a lullaby.',
    '\u201cYou remember. That is the horror and the gift,\u201d it says. \u201cNow choose what the remembering is for.\u201d',
  ],
  choices: [
    {
      id: 'loosen',
      label: 'Sing the leash loose \u2014 let the world stand without chains',
      verbs: ['loosen', 'sing'],
      next: 'ch32_kaldareth_healed',
      effects: [{ op: 'flag', key: 'litany_loosened' }],
    },
    {
      id: 'hold',
      label: 'Hold the leash \u2014 some songs must outlive their meaning',
      verbs: ['hold'],
      next: 'ch32_kaldareth_healed',
      effects: [{ op: 'flag', key: 'litany_held' }],
    },
  ],
}
inserted += 1

// Wire the ninth-echo door into the healed ending: the run must have kept all
// eight true answers. The door sits before the ending's own prose.
const healed = content.nodes['ch32_kaldareth_healed']
const endingFirst = {
  id: 'to_healed',
  label: 'Let the quiet come',
  verbs: ['quiet', 'let'],
  next: 'ch32_kaldareth_healed',
}
healed.choices = healed.choices ?? []
healed.choices.push({
  id: 'ninth',
  label: 'Answer the Hollowing \u2014 you owe it eight truths',
  verbs: ['answer', 'ninth'],
  next: 'litany_ninth',
  requires: [
    {
      kind: 'flags_all',
      keys: CHECKS.map((check) => `litany_true_${check.chapter}`),
    },
  ],
})
void endingFirst

writeFileSync(path, JSON.stringify(content, null, 2) + '\n')
console.log(`inserted ${inserted} nodes; rewired ${CHECKS.length} anchors; wired the ninth door`)
