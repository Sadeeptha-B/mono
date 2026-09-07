/**
 * Host permissions, asked for one site at a time.
 *
 * This exists because of a mistake worth recording. The first version of this
 * extension asked for `declarativeNetRequest` and nothing else, on the strength
 * of that permission granting implicit access to rules. It does — but only to
 * `allow`, `allowAllRequests` and `block`. **A `redirect` rule additionally
 * needs host permission for the URL being redirected**, and without it the rule
 * is installed, matches nothing, and reports no error. The extension would have
 * shipped looking correct and blocking nothing.
 *
 * The fix is not to ask for every site. `*://*\/*` at install time is the single
 * loudest warning Chrome shows, it is named in the Web Store's own review
 * guidance as a major cause of extended review, and it would be a lie about what
 * this does: it reads no page and watches no navigation. So permission is
 * optional, and requested for one host at a time from the click that adds that
 * host to the list. A broader grant may already cover what they typed — Chrome
 * evaluates match-pattern coverage rather than keeping independent per-row
 * booleans — but Mono never asks beyond the hostname the action requires.
 *
 * A host without permission is still blocked — `block` needs no host access —
 * it just gets Chrome's error page instead of the interstitial. That is the
 * degradation worth having: the feature never silently stops working, it only
 * becomes less articulate.
 *
 * One detail that makes per-site grants viable at all: host permission is
 * required for the *request URL*, and for the *initiator* only on non-navigation
 * requests. Every rule here is `main_frame`, so a grant for the blocked site is
 * the whole of what is needed — nothing has to be known about where the user
 * was when they typed it.
 */

/**
 * The match pattern covering a host and its subdomains.
 *
 * `*.reddit.com` matches `reddit.com` itself as well as `old.reddit.com`, which
 * is the same span `requestDomains` covers in the rule. The two have to agree:
 * a grant narrower than the rule would leave a subdomain blocked with no
 * interstitial and no way to tell why.
 */
export const originPatternFor = (host: string): string => `*://*.${host}/*`

/** Whether redirect rules are allowed to act on this host yet. */
export async function hasHostPermission(host: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPatternFor(host)] })
  } catch {
    // A malformed pattern throws rather than returning false. Treated as "no",
    // which costs an interstitial and never costs the block.
    return false
  }
}

/**
 * Which of these hosts may be redirected.
 *
 * Asked one at a time rather than in a single `contains` call, because that
 * call is all-or-nothing: one ungranted host in the list would report the whole
 * set as missing and demote every site to a plain block.
 */
export async function redirectableHosts(hosts: readonly string[]): Promise<string[]> {
  const answers = await Promise.all(
    hosts.map(async (host) => ((await hasHostPermission(host)) ? host : null)),
  )
  return answers.filter((host): host is string => host !== null)
}

/**
 * Ask for one host. Must be called from a user gesture, which in practice means
 * a click handler in the popup — Chrome refuses the prompt otherwise, and
 * refuses it by resolving `false` rather than by throwing.
 */
export async function requestHostPermission(host: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [originPatternFor(host)] })
  } catch {
    return false
  }
}

/**
 * Give back a host's permission when it leaves the list.
 *
 * Not strictly required — an unused grant harms nobody — but an extension that
 * accumulates permissions it no longer uses is one that cannot honestly answer
 * "why do you have access to this site?". Match patterns overlap, so removing a
 * parent grant can also demote listed child hosts; the popup must re-query the
 * surviving list after this call rather than editing one cached permission bit.
 */
export async function dropHostPermission(host: string): Promise<boolean> {
  try {
    return await chrome.permissions.remove({ origins: [originPatternFor(host)] })
  } catch {
    return false
  }
}
