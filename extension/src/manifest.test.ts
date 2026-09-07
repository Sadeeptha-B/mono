/**
 * The store build must not inherit permissions that exist only for tooling.
 *
 * Content-script matches are permission-bearing manifest entries. Keeping this
 * distinction executable prevents a convenient localhost origin from silently
 * returning to the archive submitted to the Chrome Web Store.
 */

import { describe, expect, it } from 'vitest'

import { buildManifest } from './manifest'
import { MONO_MATCHES, MONO_PRODUCTION_MATCHES } from './origins'

const matchesIn = (manifest: Record<string, unknown>): string[] => {
  const scripts = manifest.content_scripts as { matches: string[] }[]
  return scripts[0]?.matches ?? []
}

describe('extension manifest origins', () => {
  it('keeps the default store build production-scoped', () => {
    expect(matchesIn(buildManifest('1.0.0'))).toEqual([...MONO_PRODUCTION_MATCHES])
  })

  it('adds localhost only for an explicit development build', () => {
    expect(matchesIn(buildManifest('1.0.0', { development: true }))).toEqual([...MONO_MATCHES])
  })
})
