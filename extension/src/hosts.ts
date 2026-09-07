/**
 * Turning what someone typed into a hostname a blocking rule can use.
 *
 * People paste whole URLs, type `www.` out of habit, and occasionally add a
 * trailing slash. All three should mean the obvious thing rather than silently
 * producing a rule that matches nothing — a blocklist entry that looks right
 * and does not work is worse than a rejected one, because you find out about it
 * halfway through a block.
 *
 * `www.` is stripped rather than kept because `requestDomains` in a
 * declarativeNetRequest rule already matches subdomains: `reddit.com` covers
 * `www.reddit.com` and `old.reddit.com`, while `www.reddit.com` covers only
 * itself. Keeping the prefix would quietly narrow the rule to less than the
 * user asked for.
 *
 * Pure, and it stays that way — no `chrome.*` here, which is what lets it be
 * tested in the ordinary vitest run alongside the domain.
 */

/** Deliberately conservative: ASCII only, with no Unicode-to-punycode conversion. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Maximum textual hostname length without the optional trailing root dot. */
const MAX_HOST_LENGTH = 253

/**
 * A hostname, or `null` if there is nothing usable in there.
 *
 * Returning `null` rather than throwing because the only caller is a text field
 * being typed into, where "not yet valid" is the normal state of the input
 * rather than an error worth reporting.
 */
export function normaliseHost(input: string): string | null {
  let value = input.trim().toLowerCase()
  if (value === '') return null

  // A pasted URL. Take the authority and drop everything around it, rather than
  // asking the user to edit what they pasted.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/^[^/@]*@/, '')
  const authority = value.split(/[/?#]/, 1)[0] ?? ''

  // An IPv6 literal has colons that are not a port; nothing here is going to be
  // one, so declining is better than mangling it into something that matches.
  if (authority.includes('[') || authority.includes(']')) return null

  const host = authority.split(':', 1)[0] ?? ''
  const bare = host.startsWith('www.') ? host.slice(4) : host

  if (bare === '' || bare.endsWith('.') || bare.length > MAX_HOST_LENGTH) return null

  const labels = bare.split('.')
  // A single label is a machine on the local network, not a site worth blocking,
  // and accepting one would let `localhost` through into a rule that could
  // block the dev server.
  if (labels.length < 2) return null
  if (!labels.every((label) => LABEL.test(label))) return null

  return bare
}

/**
 * Normalise a whole list, dropping what cannot be read and anything repeated.
 *
 * Order is the order they were added: the popup shows this list back, and a
 * list that reshuffles itself when you add to it is harder to scan than one
 * that grows at the bottom.
 */
export function normaliseHosts(inputs: readonly string[]): string[] {
  const seen = new Set<string>()
  const hosts: string[] = []

  for (const input of inputs) {
    const host = normaliseHost(input)
    if (host === null || seen.has(host)) continue
    seen.add(host)
    hosts.push(host)
  }

  return hosts
}
