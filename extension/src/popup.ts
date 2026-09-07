/**
 * The popup: the blocklist, and whether anything is running.
 *
 * The list is the user's own and nothing is shipped in it. A curated set of
 * categories would save a minute of typing at the cost of Mono asserting which
 * parts of someone's life are a distraction, which is a judgement it has not
 * earned and would get wrong for anyone whose work happens on one of them.
 * The rest of the app asks rather than assumes; so does this.
 *
 * The service worker owns the stored list. This reads it on open and writes the
 * whole list back on every change. One change is allowed in flight at a time,
 * and a lost reply causes a canonical re-read rather than a guess about which
 * side of the write the worker reached.
 *
 * **This is also the only place a host permission can be asked for.** Chrome
 * grants one in answer to a user gesture and at no other time, and the click
 * that adds a site is the honest moment: the user has just named the site, so
 * the prompt names the same one. Declining is a supported answer rather than an
 * error — the site is still blocked, it just gets Chrome's error page instead
 * of the reminder — which is why the row says which of the two it will get
 * rather than treating the ungranted state as a fault.
 */

import { formatDuration } from '@/domain/time'
import { normaliseHost } from './hosts'
import { monoHostsCoveredBy } from './origins'
import { dropHostPermission, requestHostPermission } from './permissions'

import './shared.css'
import './popup.css'
import type { GetStatusReply, SetHostsReply, StatusReply } from './messages'

const form = document.getElementById('add')
const field = document.getElementById('host')
const hint = document.getElementById('hint')
const list = document.getElementById('list')
const status = document.getElementById('status')

let hosts: string[] = []
let redirectable = new Set<string>()
let changing = false
let stateKnown = false

const RULES_PENDING_WAKE_MESSAGE =
  'Saved — but the browser would not take the new rules. Mono will retry when it next wakes.'

function say(message: string): void {
  if (hint) hint.textContent = message
}

/**
 * Push the list to the worker without changing the visible canonical copy.
 *
 * The list and the browser's rules are two separate writes and cannot be made
 * one, so the worker can end up having saved a list it could not install. That
 * matters most in the direction the popup would otherwise hide: a site removed
 * from a list that still has a rule behind it goes on being blocked, from a row
 * that is no longer on screen. So the answer is shown rather than assumed, and
 * the worker schedules its own retry. A null result means only that the reply
 * was lost; the caller re-reads before either committing or compensating.
 */
async function save(next: string[]): Promise<SetHostsReply | null> {
  try {
    const reply = (await chrome.runtime.sendMessage({ kind: 'setHosts', hosts: next })) as
      | SetHostsReply
      | undefined
    return reply?.stored === true || reply?.stored === false ? reply : null
  } catch {
    // The worker may have committed before the reply channel disappeared. The
    // caller must re-read canonical state before rolling back or compensating.
    return null
  }
}

function describeProjection(reply: Extract<SetHostsReply, { stored: true }>): boolean {
  if (reply.applied) return false

  say(
    reply.retryScheduled
      ? 'Saved — but the browser would not take the new rules just yet. Trying again shortly.'
      : RULES_PENDING_WAKE_MESSAGE,
  )
  return true
}

async function readStatus(): Promise<StatusReply | null> {
  try {
    const reply = (await chrome.runtime.sendMessage({ kind: 'getStatus' })) as
      | GetStatusReply
      | undefined
    if (reply?.available !== true) return null
    return reply
  } catch {
    return null
  }
}

function adoptStatus(reply: StatusReply): void {
  stateKnown = true
  hosts = reply.hosts
  redirectable = new Set(reply.redirectable)
  renderList()
  renderStatus(reply.armed)
}

function setChanging(next: boolean): void {
  changing = next
  const disabled = next || !stateKnown
  if (field instanceof HTMLInputElement) field.disabled = disabled
  if (form instanceof HTMLFormElement) {
    const submit = form.querySelector('button[type="submit"]')
    if (submit instanceof HTMLButtonElement) submit.disabled = disabled
  }
  renderList()
}

/**
 * One row: the site, whether it will explain itself, and a way to remove it.
 *
 * The permission state is shown as a control rather than a badge when it is
 * missing, because it is actionable — one click asks again for anyone who
 * dismissed the first prompt without meaning to.
 */
function renderRow(host: string): HTMLLIElement {
  const row = document.createElement('li')
  row.className = 'row'

  const name = document.createElement('span')
  name.className = 'host'
  name.textContent = host

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'remove'
  remove.textContent = '×'
  // The visible label is a symbol, so the accessible one has to carry the
  // whole sentence — the same rule the app follows for its own × controls.
  remove.setAttribute('aria-label', `Stop blocking ${host}`)
  remove.disabled = changing || !stateKnown
  remove.addEventListener('click', () => {
    if (changing) return
    setChanging(true)
    void (async () => {
      try {
        const next = hosts.filter((entry) => entry !== host)
        const wasRedirectable = redirectable.has(host)
        let rulesPending = false
        const reply = await save(next)

        if (reply === null) {
          const status = await readStatus()
          if (status === null) {
            stateKnown = false
            say('Could not confirm whether that change was saved. Reopen Mono blocking to check.')
            return
          }
          adoptStatus(status)
          rulesPending = status.rulesPending
          if (status.hosts.includes(host)) {
            say(`${host} is still on the list — the removal was not saved.`)
            return
          }
        } else if (!reply.stored) {
          say(`${host} is still on the list — the removal was not saved.`)
          return
        } else {
          hosts = next
          renderList()
        }

        // Persist first, then give the grant back even when DNR application is
        // pending. Revocation immediately prevents a stale redirect from
        // continuing to match and triggers another worker reconciliation.
        const removed = await dropHostPermission(host)

        // Match patterns subsume one another. Removing a parent grant can also
        // demote a surviving child row, so the worker's permission query is the
        // only truthful state after revocation; editing one local set entry is
        // not enough.
        const refreshed = await readStatus()
        if (refreshed === null) {
          stateKnown = false
          renderList()
          say(
            `${host} was removed, but Mono could not refresh the remaining permissions. ` +
              'Reopen this popup to check.',
          )
          return
        }
        adoptStatus(refreshed)
        rulesPending = refreshed.rulesPending

        if (rulesPending) {
          if (reply?.stored === true && !reply.applied) {
            describeProjection(reply)
            return
          }
          say(RULES_PENDING_WAKE_MESSAGE)
          return
        }
        if (wasRedirectable && !removed) {
          say(`${host} was removed, but Chrome kept its reminder permission.`)
        } else {
          say(`${host} is no longer blocked.`)
        }
      } finally {
        setChanging(false)
      }
    })()
  })

  if (!stateKnown) {
    const permission = document.createElement('span')
    permission.className = 'state unknown'
    permission.textContent = 'permission unavailable'
    row.append(name, permission, remove)
    return row
  }

  if (redirectable.has(host)) {
    const state = document.createElement('span')
    state.className = 'state granted'
    state.textContent = 'shows the reminder'
    row.append(name, state, remove)
    return row
  }

  const grant = document.createElement('button')
  grant.type = 'button'
  grant.className = 'state ungranted'
  grant.textContent = 'blocked only — allow reminder'
  grant.setAttribute('aria-label', `Allow the reminder page for ${host}`)
  grant.disabled = changing || !stateKnown
  grant.addEventListener('click', () => {
    if (changing) return
    setChanging(true)
    void (async () => {
      try {
        if (await requestHostPermission(host)) {
          redirectable.add(host)
          renderList()
          say('')
          return
        }
        say(`${host} stays blocked — Chrome will show its own error page instead.`)
      } finally {
        setChanging(false)
      }
    })()
  })

  row.append(name, grant, remove)
  return row
}

function renderList(): void {
  if (!list) return
  list.textContent = ''
  for (const host of hosts) list.append(renderRow(host))
}

function renderStatus(armed: StatusReply['armed']): void {
  if (!status) return

  if (armed === null || armed.endsAt <= Date.now()) {
    status.dataset.running = 'false'
    status.textContent = 'Not blocking'
    return
  }

  status.dataset.running = 'true'
  // Rounded to the minute rather than counting down. The popup closes the
  // moment you click anywhere else, so a live second hand would be motion
  // nobody sees, and this is the one number worth knowing.
  status.textContent = `Blocking · ${formatDuration(armed.endsAt - Date.now())} left`
}

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!(field instanceof HTMLInputElement) || changing) return

  const host = normaliseHost(field.value)

  if (host === null) {
    say('That does not look like a site. Try something like reddit.com.')
    return
  }

  // Refused rather than accepted-and-carved-out. Every rule excludes Mono, so
  // an entry naming it exactly would sit in the list doing nothing at all, and
  // a line that looks like it works is worse than one that was turned away.
  // A *parent* of Mono's host is a fair thing to block and is allowed through;
  // the carve-out handles it, and the note below says so.
  const coversMono = monoHostsCoveredBy(host)
  if (coversMono.includes(host)) {
    say(`${host} is where Mono lives — blocking it would leave no way to end a block.`)
    return
  }

  if (hosts.includes(host)) {
    say(`${host} is already on the list.`)
    field.value = ''
    return
  }

  say('')
  field.value = ''
  setChanging(true)

  void (async () => {
    try {
      // Asked from inside the submit handler, which is still a user gesture.
      // The permission is compensated if the following storage write fails.
      const granted = await requestHostPermission(host)
      const next = [...hosts, host]
      let rulesPending = false
      const reply = await save(next)

      if (reply === null) {
        const status = await readStatus()
        if (status === null) {
          stateKnown = false
          say('Could not confirm whether that site was saved. Reopen Mono blocking to check.')
          return
        }
        adoptStatus(status)
        rulesPending = status.rulesPending
        if (!status.hosts.includes(host)) {
          const removed = !granted || (await dropHostPermission(host))
          say(
            removed
              ? `${host} was not saved.`
              : `${host} was not saved, but Chrome kept its reminder permission.`,
          )
          return
        }
      } else if (!reply.stored) {
        const removed = !granted || (await dropHostPermission(host))
        say(
          removed
            ? `${host} was not saved.`
            : `${host} was not saved, but Chrome kept its reminder permission.`,
        )
        return
      } else {
        hosts = next
        if (granted) redirectable.add(host)
        renderList()
        if (describeProjection(reply)) return
      }

      if (rulesPending) {
        say(RULES_PENDING_WAKE_MESSAGE)
        return
      }

      if (!granted) {
        say(`${host} will be blocked, without the reminder page.`)
      } else if (coversMono.length > 0) {
        say(`${host} will be blocked — Mono itself stays reachable.`)
      }
    } finally {
      setChanging(false)
    }
  })()
})

setChanging(true)
void (async () => {
  const reply = await readStatus()
  if (reply === null) {
    if (status) {
      status.dataset.running = 'false'
      status.textContent = 'Status unavailable'
    }
    say('Mono blocking could not read its saved state. Close and reopen this popup to retry.')
    setChanging(false)
    return
  }
  adoptStatus(reply)
  if (reply.rulesPending) {
    say('The browser has not taken the saved rules yet. Mono will retry when it next wakes.')
  }
  setChanging(false)
})()
