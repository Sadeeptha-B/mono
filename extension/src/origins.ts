/**
 * Where Mono lives, in the three forms the rest of the extension needs it.
 *
 * This is the one place any of them is written down. The manifest is generated
 * from it at build time rather than checked in beside it (see
 * `scripts/build-extension.ts`), because a content script injected into an
 * origin the service worker then refuses to listen to is a feature that is
 * silently, completely dead — and nothing about either list looks wrong on its
 * own. The same instinct as generating the app icons from the companion's own
 * frames: the copy that could drift is not written by hand.
 *
 * Adding a deployment means adding it here and rebuilding. Note that a change
 * here is a manifest change, which for a published extension means a store
 * review — so moving Mono to a custom domain is a two-week round trip, not an
 * afternoon.
 */

/** Match patterns for `content_scripts`. These carry a path; origins do not. */
export const MONO_PRODUCTION_MATCHES = [
  'https://sadeeptha-b.github.io/mono/*',
] as const

export const MONO_DEVELOPMENT_MATCHES = [
  // The dev server and the production preview the e2e suite runs against. Both
  // are kept so the extension can be developed and hand-checked without
  // deploying, but they are included only in an explicit development build:
  // store artifacts may not request permissions solely for tooling.
  'http://localhost:5173/*',
  'http://localhost:4173/*',
] as const

/** Every origin a build may inject into and the worker may therefore trust. */
export const MONO_MATCHES = [...MONO_PRODUCTION_MATCHES, ...MONO_DEVELOPMENT_MATCHES] as const

/**
 * What `sender.origin` will be for a message we are willing to act on.
 *
 * Deliberately derived from the patterns above rather than listed again.
 * `sender.origin` carries no path, so this check is coarser than the injection
 * rule. A store worker consequently retains localhost in this allowlist while
 * its manifest injects only on production. That superset is unreachable from a
 * web page: without `externally_connectable` it cannot message the extension,
 * and other extensions arrive on `onMessageExternal`. Keeping one derived
 * allowlist avoids introducing a build-time copy that could reject an origin
 * the development manifest actually injects into.
 */
export const MONO_ORIGINS: readonly string[] = MONO_MATCHES.map(
  (pattern) => new URL(pattern.replace(/\*$/, '')).origin,
)

/**
 * The hostnames Mono is served from, which no blocking rule may ever match.
 *
 * Mono's own origin is an ordinary hostname, so nothing stopped it being typed
 * into the blocklist — and `sadeeptha-b.github.io` is not even the dangerous
 * case. `requestDomains` matches subdomains, so an entry for `github.io` covers
 * Mono too, and a user blocking a whole host they have every right to block
 * would take Mono down as collateral.
 *
 * That failure has no way out from inside. Blocking is ended by asking Mono to
 * abandon the block, so a blocked Mono is a blocked *escape route*: the
 * interstitial's button opens the app, the app is redirected back to the
 * interstitial, and the only remaining exits are waiting out a best-effort
 * expiry or quitting the browser. The rules must therefore carve Mono out
 * themselves rather than trusting the list to be sensible — see
 * `excludedRequestDomains` in `rules.ts`.
 *
 * Derived from the patterns above so it cannot drift, and it includes the dev
 * origins for the same reason they are matched at all: the feature has to be
 * workable without deploying. Consequently production rules also exclude
 * `localhost`; the popup refuses single-label hosts anyway, so that deliberate
 * development carve-out cannot narrow anything a user could add to the list.
 */
export const MONO_HOSTS: readonly string[] = [
  ...new Set(MONO_MATCHES.map((pattern) => new URL(pattern.replace(/\*$/, '')).hostname)),
]

/**
 * Which of Mono's own hostnames a rule for `host` would otherwise have matched.
 *
 * Both halves matter and they are answered differently. An exact match is an
 * entry the popup refuses, because a rule that is carved out down to nothing is
 * a line in a list that does not do anything. A parent domain — `github.io` —
 * is a legitimate thing to block, so it is accepted and Mono is quietly the one
 * exception to it.
 *
 * The suffix test mirrors what `requestDomains` does: a domain matches itself
 * and anything under it, and nothing else. `endsWith` alone would make `hub.io`
 * look like a parent of `github.io`, which is why the dot is in the comparison.
 */
export const monoHostsCoveredBy = (host: string): string[] =>
  MONO_HOSTS.filter((mono) => mono === host || mono.endsWith(`.${host}`))

/**
 * Where to send someone who needs the app and has no tab open on it.
 *
 * Deliberately the deployed app, not whichever development origin last spoke:
 * the lease stores no origin and should not acquire one merely for tooling. A
 * localhost block lives in different `localStorage`, so manual QA there can
 * verify fail-open rule removal but not the fresh page recording abandonment.
 */
export const MONO_APP_URL = 'https://sadeeptha-b.github.io/mono/'
