/**
 * Shared content loading for the check scripts.
 *
 * Scripts import the same zod schemas the browser bundle uses, so CI and the
 * game can never disagree about what valid content is.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { balanceSchema, gameDataSchema, storyContentSchema } from '../../src/content/schema.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..', '..')
export const CONTENT_DIR = join(ROOT, 'content')

export function readJson(...segments) {
  const path = join(CONTENT_DIR, ...segments)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`)
  }
}

function formatZod(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : []
  if (issues.length === 0) return [String(error)]
  return issues.map((issue) => {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}

export function loadAll() {
  const errors = []

  const content = shape(readJson('kaldareth.act1.json'), storyContentSchema, 'kaldareth.act1.json', errors)
  const data = shape(readJson('kaldareth.json'), gameDataSchema, 'kaldareth.json', errors)
  const balance = shape(readJson('balance.json'), balanceSchema, 'balance.json', errors)

  if (errors.length > 0) {
    const error = new Error('Content failed shape validation')
    error.shapeErrors = errors
    throw error
  }

  return { content, data, balance }
}

function shape(raw, schema, name, errors) {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  errors.push(`[${name}]\n  - ${formatZod(result.error).join('\n  - ')}`)
  return null
}

/* ── Reporting ────────────────────────────────────────────────────────── */

export class Report {
  constructor(title) {
    this.title = title
    this.errors = []
    this.warnings = []
    this.notes = []
  }

  error(message) {
    this.errors.push(message)
  }

  warn(message) {
    this.warnings.push(message)
  }

  note(message) {
    this.notes.push(message)
  }

  /** Distinct section headers make a 200-line report scannable. */
  section(name) {
    this.notes.push(`\n${name}`)
  }

  print({ strict = false } = {}) {
    process.stdout.write(`\n${this.title}\n${'='.repeat(this.title.length)}\n`)

    for (const note of this.notes) process.stdout.write(`${note}\n`)

    if (this.warnings.length > 0) {
      process.stdout.write(`\n${this.warnings.length} warning(s):\n`)
      for (const w of this.warnings) process.stdout.write(`  ! ${w}\n`)
    }

    if (this.errors.length > 0) {
      process.stdout.write(`\n${this.errors.length} error(s):\n`)
      for (const e of this.errors) process.stdout.write(`  x ${e}\n`)
    }

    const failed = this.errors.length > 0 || (strict && this.warnings.length > 0)
    if (failed) {
      process.stdout.write(`\nFAILED${strict && this.errors.length === 0 ? ' (warnings are errors under --strict)' : ''}\n`)
    } else {
      process.stdout.write('\nOK\n')
    }
    return failed
  }
}

export const strictFlag = process.argv.includes('--strict')
