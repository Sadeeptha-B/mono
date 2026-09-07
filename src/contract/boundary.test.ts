/**
 * The module boundary between the app and the extension, as an assertion.
 *
 * The extension shares Mono's repository, its TypeScript config and its `@/`
 * alias, which is the whole point — the contract type between them is a compile
 * error when it breaks rather than a silent failure in someone's browser. The
 * cost of that convenience is that nothing physically stops an extension file
 * importing the store, or a component, or the planner. An import like that
 * would typecheck, build, and produce a service worker with React inside it.
 *
 * Worse than the bundle size is what it would mean. The extension must never
 * derive a plan — one process computes the day or two schedules can disagree —
 * and `@/domain/planner` being one autocomplete away is exactly how that stops
 * being true. So the rule is executable, in the spirit of `scene.test.ts`
 * pinning the floor to the sprite: a cross-module invariant nobody reads until
 * after they have broken it is better written as a test than as a paragraph.
 *
 * This walks the real import graph from the four entry points rather than
 * grepping, because the interesting failure is transitive. Importing something
 * innocent that itself imports the store is precisely the mistake worth
 * catching, and it is the one a grep misses.
 */

import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolvePath(__dirname, '../..')

/** Everything that ships in the extension, and everything they can reach. */
const ENTRIES = [
  'extension/src/background.ts',
  'extension/src/bridge.content.ts',
  'extension/src/blocked.ts',
  'extension/src/popup.ts',
]

/**
 * What the extension may never reach, and why each one is here.
 *
 * `@/store` and `@/app` would drag zustand and the whole session in. `react`
 * and `motion` are the app's rendering stack and have no business in a service
 * worker. `@/blocking` is the app-side adapter, not shared vocabulary.
 * `@/domain/planner` is the invariant: the extension is handed a conclusion,
 * never the means to compute its own.
 */
const FORBIDDEN = [
  { test: (id: string) => id === 'react' || id.startsWith('react/'), label: 'react' },
  { test: (id: string) => id === 'react-dom' || id.startsWith('react-dom/'), label: 'react-dom' },
  { test: (id: string) => id === 'motion' || id.startsWith('motion/'), label: 'motion' },
  { test: (id: string) => id === 'zustand' || id.startsWith('zustand/'), label: 'zustand' },
  { test: (id: string) => id.startsWith('@/store'), label: '@/store' },
  { test: (id: string) => id.startsWith('@/app'), label: '@/app' },
  { test: (id: string) => id.startsWith('@/components'), label: '@/components' },
  { test: (id: string) => id.startsWith('@/hooks'), label: '@/hooks' },
  { test: (id: string) => id.startsWith('@/pip'), label: '@/pip' },
  { test: (id: string) => id.startsWith('@/pwa'), label: '@/pwa' },
  { test: (id: string) => id.startsWith('@/blocking'), label: '@/blocking' },
  { test: (id: string) => id.startsWith('@/domain/planner'), label: '@/domain/planner' },
]

/**
 * Every specifier in a file, type-only imports included.
 *
 * Type imports are erased and cannot pull anything into the bundle, so leaving
 * them in makes this stricter than the runtime graph. That is deliberate: the
 * rule being kept is about what the extension is allowed to *know*, and a
 * type-only import of the store's shape is still the extension modelling the
 * app's internals. `import type { BlockKind }` from `@/domain/types` stays
 * legal because `@/domain/types` is not on the list.
 */
function specifiersIn(source: string): string[] {
  const found: string[] = []
  const pattern = /(?:from|import)\s*['"]([^'"]+)['"]/g

  let match = pattern.exec(source)
  while (match !== null) {
    const specifier = match[1]
    if (specifier !== undefined) found.push(specifier)
    match = pattern.exec(source)
  }

  return found
}

/** Turn a specifier into a path on disk, or null for a bare package name. */
function toFile(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolvePath(dirname(fromFile), specifier)
      : null

  if (base === null) return null

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      // A directory exists at `base` when the specifier names a folder; only
      // the index form is a real module.
      try {
        if (readFileSync(candidate).length >= 0) return candidate
      } catch {
        continue
      }
    }
  }

  return null
}

function walk(entry: string): { file: string; specifier: string; label: string }[] {
  const violations: { file: string; specifier: string; label: string }[] = []
  const seen = new Set<string>()
  const queue = [join(ROOT, entry)]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)

    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const specifier of specifiersIn(source)) {
      // CSS is loaded by the HTML entries, not by these modules, and a
      // stylesheet cannot import code.
      if (specifier.endsWith('.css')) continue

      const forbidden = FORBIDDEN.find((rule) => rule.test(specifier))
      if (forbidden) {
        violations.push({ file: file.slice(ROOT.length + 1), specifier, label: forbidden.label })
        continue
      }

      const next = toFile(specifier, file)
      if (next !== null) queue.push(next)
    }
  }

  return violations
}

describe('the extension cannot reach the app', () => {
  for (const entry of ENTRIES) {
    it(`${entry} imports nothing from the app's stack`, () => {
      expect(walk(entry)).toEqual([])
    })
  }

  // A guard on the guard. If the entry list or the resolver silently stopped
  // finding anything, every assertion above would pass on an empty graph and
  // the whole file would be decoration.
  it('actually resolves the graph it claims to walk', () => {
    const source = readFileSync(join(ROOT, 'extension/src/background.ts'), 'utf8')
    expect(specifiersIn(source)).toContain('@/contract/blocking')
    expect(toFile('@/contract/blocking', join(ROOT, 'extension/src/background.ts'))).not.toBeNull()
  })
})
