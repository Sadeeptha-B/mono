/**
 * The rule shape, and the hostname reader.
 *
 * Both are pure, which is the reason they live outside the service worker: the
 * details that matter about a blocking rule are details a test can hold still,
 * and the ones that would otherwise only be discovered by loading the extension
 * and navigating somewhere.
 */

import { describe, expect, it } from 'vitest'

import { normaliseHost, normaliseHosts } from './hosts'
import { MONO_HOSTS, monoHostsCoveredBy } from './origins'
import { BLOCKED_PAGE_PATH, rulesForHosts } from './rules'

/**
 * Mono's own origin is an ordinary hostname, so nothing stops it reaching the
 * blocklist — and the exact entry is not even the dangerous one. `github.io`
 * covers Mono too, because `requestDomains` matches subdomains.
 *
 * A blocked Mono is a blocked escape route: blocking ends by asking Mono to
 * abandon the block, so the interstitial's button opens the app and the app is
 * redirected straight back. The carve-out therefore lives in the rules, where
 * no amount of nonsense in storage can get past it, rather than only where
 * hosts are typed.
 */
describe('Mono is carved out of every rule', () => {
  it.each([
    ['a plain block', [] as string[]],
    ['a redirect to the reminder', ['reddit.com']],
  ])('excludes its own origins from %s', (_label, redirectable) => {
    const [rule] = rulesForHosts(['reddit.com'], redirectable)
    expect(rule?.condition.excludedRequestDomains).toEqual([...MONO_HOSTS])
  })

  it('excludes it even when the entry is a parent domain of Mono', () => {
    // The rule is still installed and still blocks the rest of github.io. Chrome
    // gives the exclusion precedence over `requestDomains`, so Mono survives it.
    const [rule] = rulesForHosts(['github.io'], [])
    expect(rule?.condition.requestDomains).toEqual(['github.io'])
    expect(rule?.condition.excludedRequestDomains).toContain('sadeeptha-b.github.io')
  })

  it('covers the dev origins too, so the feature is workable undeployed', () => {
    expect(MONO_HOSTS).toContain('localhost')
  })
})

describe('monoHostsCoveredBy', () => {
  it('names Mono for its own hostname, which the popup refuses outright', () => {
    expect(monoHostsCoveredBy('sadeeptha-b.github.io')).toContain('sadeeptha-b.github.io')
  })

  it('names Mono for a parent domain, which the popup allows and annotates', () => {
    expect(monoHostsCoveredBy('github.io')).toEqual(['sadeeptha-b.github.io'])
  })

  it('names nothing for an unrelated site', () => {
    expect(monoHostsCoveredBy('reddit.com')).toEqual([])
  })

  it('does not mistake a shared suffix for a parent domain', () => {
    // `sadeeptha-b.github.io` ends with `hub.io`, and is not under it.
    expect(monoHostsCoveredBy('hub.io')).toEqual([])
  })
})

describe('rulesForHosts', () => {
  it('makes one rule per host, in list order', () => {
    const rules = rulesForHosts(['reddit.com', 'news.ycombinator.com'], [])
    expect(rules).toHaveLength(2)
    expect(rules.map((rule) => rule.condition.requestDomains)).toEqual([
      ['reddit.com'],
      ['news.ycombinator.com'],
    ])
  })

  it('gives every rule a unique id', () => {
    const rules = rulesForHosts(['a.com', 'b.com', 'c.com'], [])
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(3)
  })

  /**
   * The one that would be found by a user rather than by a developer. A rule
   * matching subresources stops a blocked site's scripts and images loading
   * inside pages that are *allowed*, and the result reads as the network being
   * broken rather than as Mono blocking anything.
   */
  it('matches main frames and nothing else', () => {
    for (const rule of rulesForHosts(['reddit.com'], ['reddit.com'])) {
      expect(rule.condition.resourceTypes).toEqual(['main_frame'])
    }
  })

  it('redirects to the interstitial where the host has been granted', () => {
    const rule = rulesForHosts(['reddit.com'], ['reddit.com'])[0]
    expect(rule?.action.type).toBe('redirect')
    expect(rule?.action.redirect?.extensionPath).toBe(BLOCKED_PAGE_PATH)
  })

  /**
   * The finding that made this parameter exist. `declarativeNetRequest` grants
   * implicit access to `allow`, `allowAllRequests` and `block` — not to
   * `redirect`, which needs host permission for the URL it acts on. A redirect
   * rule without that permission installs, matches nothing, and reports no
   * error, so the extension blocks nothing while looking entirely correct.
   *
   * The fallback is what keeps the promise: the site is still blocked, it just
   * gets Chrome's error page instead of the reminder.
   */
  it('blocks rather than redirects where the host has not been granted', () => {
    const rule = rulesForHosts(['reddit.com'], [])[0]
    expect(rule?.action.type).toBe('block')
    expect(rule?.action.redirect).toBeUndefined()
  })

  it('decides per host rather than for the list as a whole', () => {
    const rules = rulesForHosts(['granted.com', 'not.com'], ['granted.com'])
    expect(rules.map((rule) => rule.action.type)).toEqual(['redirect', 'block'])
  })

  it('still blocks every host when nothing at all has been granted', () => {
    const rules = rulesForHosts(['a.com', 'b.com'], [])
    expect(rules).toHaveLength(2)
    expect(rules.every((rule) => rule.action.type === 'block')).toBe(true)
  })

  /**
   * A grant for a host no longer on the list must not resurrect it. The two
   * lists are read from different places — storage and Chrome's permission
   * store — and only the blocklist decides what exists.
   */
  it('ignores granted hosts that are not on the list', () => {
    expect(rulesForHosts(['a.com'], ['a.com', 'ghost.com'])).toHaveLength(1)
  })

  it('is empty for an empty list, which is what disarming produces', () => {
    expect(rulesForHosts([], [])).toEqual([])
  })
})

describe('normaliseHost', () => {
  it.each([
    ['reddit.com', 'reddit.com'],
    ['  Reddit.COM  ', 'reddit.com'],
    ['https://reddit.com', 'reddit.com'],
    ['https://reddit.com/r/all?sort=new#top', 'reddit.com'],
    ['http://reddit.com:8080/', 'reddit.com'],
    ['news.ycombinator.com', 'news.ycombinator.com'],
  ])('reads %s as %s', (input, expected) => {
    expect(normaliseHost(input)).toBe(expected)
  })

  /**
   * `requestDomains` already matches subdomains, so `reddit.com` covers
   * `www.reddit.com` while `www.reddit.com` covers only itself. Keeping the
   * prefix would quietly narrow the rule to less than the user asked for.
   */
  it('drops a www prefix, because keeping it would narrow the rule', () => {
    expect(normaliseHost('www.reddit.com')).toBe('reddit.com')
    expect(normaliseHost('https://www.reddit.com/')).toBe('reddit.com')
  })

  it.each([
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a single label', 'localhost'],
    ['a trailing dot', 'reddit.com.'],
    ['a leading dot', '.reddit.com'],
    ['a space inside', 'red dit.com'],
    ['a label starting with a hyphen', '-reddit.com'],
    ['a hostname longer than DNS permits', `${'a.'.repeat(126)}aa`],
    ['an IPv6 literal', 'http://[::1]:5173/'],
    ['something that is only a scheme', 'https://'],
  ])('refuses %s', (_label, input) => {
    expect(normaliseHost(input)).toBeNull()
  })

  // `localhost` being refused is not incidental. The dev server and the preview
  // both run there, and a rule matching it would block the app that arms it.
  it('refuses localhost, which is where Mono itself runs in development', () => {
    expect(normaliseHost('localhost')).toBeNull()
    expect(normaliseHost('http://localhost:5173')).toBeNull()
  })
})

describe('normaliseHosts', () => {
  it('drops what it cannot read and keeps the rest', () => {
    expect(normaliseHosts(['reddit.com', 'nonsense', 'x.com'])).toEqual(['reddit.com', 'x.com'])
  })

  it('de-duplicates after normalising, not before', () => {
    expect(normaliseHosts(['reddit.com', 'https://www.reddit.com/r/all'])).toEqual(['reddit.com'])
  })

  it('keeps the order things were added in', () => {
    expect(normaliseHosts(['z.com', 'a.com'])).toEqual(['z.com', 'a.com'])
  })
})
